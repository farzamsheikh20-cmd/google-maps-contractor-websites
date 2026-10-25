import { Actor, log } from 'apify';
import { chromium } from 'playwright';
import { clean, domainKey, emailsFrom, makeSearchUrl, mapsPlaceKey, normalizeWebsite, safeCampaignId } from './helpers.js';

await Actor.init();
const defaults = {
  startUrls: [], searchTerms: ['commercial general contractors'], locations: ['Los Angeles, California'],
  maximumNewCompanies: 500, maximumProfilesVisited: 1000, maximumResultsPerSearch: 120,
  requireWebsite: true, collectEmailsFromCompanyWebsites: false, useResidentialProxy: true,
  proxyCountryCode: 'US', campaignName: 'google-maps-contractor-websites', resetProgress: false,
  pageTimeoutSecs: 60, delayMillis: 900
};
const input = { ...defaults, ...(await Actor.getInput()) };
const campaignId = safeCampaignId(input.campaignName);
const kv = await Actor.openKeyValueStore(`campaign-${campaignId}`);
let progress = input.resetProgress ? null : await kv.getValue('PROGRESS');
if (!progress || !Array.isArray(progress.searchQueue)) progress = {
  searchQueue: [], pendingProfiles: [], completedSearches: [], discoveredProfiles: [], processedProfiles: [], seenDomains: [], totalOutput: 0,
  masterDatasetName: `master-${campaignId}`
};

const searches = [];
for (const raw of input.startUrls || []) if (clean(raw)) searches.push({ url: clean(raw), searchTerm: null, location: null });
for (const term of input.searchTerms || []) for (const location of input.locations || []) searches.push({ url: makeSearchUrl(term, location), searchTerm: clean(term), location: clean(location) });
for (const item of searches) if (!progress.completedSearches.includes(item.url) && !progress.searchQueue.some(v => v.url === item.url)) progress.searchQueue.push(item);

const completedSearches = new Set(progress.completedSearches);
const discoveredProfiles = new Set(progress.discoveredProfiles);
const processedProfiles = new Set(progress.processedProfiles);
const seenDomains = new Set(progress.seenDomains);
const master = await Actor.openDataset(progress.masterDatasetName);
const runDataset = await Actor.openDataset();

async function save() {
  progress.completedSearches = [...completedSearches];
  progress.discoveredProfiles = [...discoveredProfiles];
  progress.processedProfiles = [...processedProfiles];
  progress.seenDomains = [...seenDomains];
  await kv.setValue('PROGRESS', progress);
}

let proxyConfiguration;
if (input.useResidentialProxy) proxyConfiguration = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'], countryCode: input.proxyCountryCode || 'US' });

async function launch() {
  let proxy;
  if (proxyConfiguration) {
    const proxyUrl = new URL(await proxyConfiguration.newUrl(`maps${Date.now()}${Math.floor(Math.random() * 100000)}`));
    proxy = { server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`, username: decodeURIComponent(proxyUrl.username), password: decodeURIComponent(proxyUrl.password) };
  }
  const browser = await chromium.launch({ headless: true, executablePath: process.env.APIFY_CHROME_EXECUTABLE_PATH || process.env.APIFY_DEFAULT_BROWSER_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'], ...(proxy ? { proxy } : {}) });
  const context = await browser.newContext({ locale: 'en-US', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36' });
  const page = await context.newPage();
  page.setDefaultTimeout(Math.min(input.pageTimeoutSecs * 1000, 30000));
  return { browser, context, page };
}

let { browser, context, page } = await launch();
if (proxyConfiguration) log.info('Residential proxy enabled', { country: input.proxyCountryCode || 'US' });

async function rotate() {
  await browser.close().catch(() => {});
  ({ browser, context, page } = await launch());
  log.info('Google Maps proxy session rotated');
}

async function navigate(url, target = page) {
  const response = await target.goto(url, { waitUntil: 'domcontentloaded', timeout: input.pageTimeoutSecs * 1000 });
  await target.waitForTimeout(input.delayMillis);
  const title = await target.title().catch(() => '');
  const body = clean(await target.locator('body').innerText().catch(() => ''));
  if (response?.status() === 403 || /unusual traffic|automated queries|verify you are human|captcha|sorry, you have been blocked/i.test(`${title} ${body.slice(0, 2000)}`)) throw new Error('Google Maps access challenge detected');
  return response?.status() || null;
}

async function acceptConsent() {
  for (const name of ['Accept all', 'I agree', 'Reject all']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.count()) { await button.first().click().catch(() => {}); await page.waitForTimeout(1000); break; }
  }
}

async function discover(item) {
  await navigate(item.url);
  await acceptConsent();
  const feed = page.locator('div[role="feed"]');
  await feed.waitFor({ state: 'visible', timeout: 20000 });
  let stagnant = 0;
  let previous = 0;
  while (discoveredProfiles.size < 200000 && stagnant < 5) {
    const links = await feed.locator('a[href*="/maps/place/"]').evaluateAll(nodes => nodes.map(a => a.href));
    for (const url of links) {
      if (progress.pendingProfiles.length >= input.maximumResultsPerSearch) break;
      const key = mapsPlaceKey(url);
      if (!key || discoveredProfiles.has(key) || processedProfiles.has(key)) continue;
      discoveredProfiles.add(key);
      progress.pendingProfiles.push({ url, sourceUrl: item.url, searchTerm: item.searchTerm, location: item.location });
    }
    if (progress.pendingProfiles.length >= input.maximumResultsPerSearch) break;
    const count = links.length;
    stagnant = count === previous ? stagnant + 1 : 0;
    previous = count;
    await feed.evaluate(el => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(1500);
    if (await page.getByText(/you've reached the end of the list/i).count()) break;
  }
  completedSearches.add(item.url);
  await save();
  log.info('Google Maps search discovered', { searchTerm: item.searchTerm, location: item.location, pendingProfiles: progress.pendingProfiles.length });
}

async function textFromButton(pattern) {
  const locator = page.locator('button[aria-label]');
  const labels = await locator.evaluateAll((nodes, source) => nodes.map(n => n.getAttribute('aria-label') || '').filter(v => new RegExp(source, 'i').test(v)), pattern.source).catch(() => []);
  return clean(labels[0]?.replace(pattern, '')) || null;
}

async function extractProfile(item) {
  await navigate(item.url);
  await acceptConsent();
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 20000 });
  const companyName = clean(await page.locator('h1').first().innerText().catch(() => ''));
  const websiteElement = page.locator('a[data-item-id="authority"], a[aria-label^="Website:"]').first();
  const website = normalizeWebsite((await websiteElement.getAttribute('href').catch(() => null)) || (await websiteElement.getAttribute('aria-label').catch(() => '')).replace(/^Website:\s*/i, ''));
  const address = await textFromButton(/^Address:\s*/i);
  const phone = await textFromButton(/^Phone:\s*/i);
  const category = clean(await page.locator('button[jsaction*="category"], button.DkEaL').first().innerText().catch(() => '')) || null;
  const ratingText = clean(await page.locator('[role="img"][aria-label*="stars"]').first().getAttribute('aria-label').catch(() => ''));
  const rating = Number.parseFloat(ratingText.match(/[0-9.]+/)?.[0]) || null;
  const reviewsText = clean(await page.locator('button[aria-label*="reviews"], span[aria-label*="reviews"]').first().getAttribute('aria-label').catch(() => ''));
  const reviewsCount = Number.parseInt((reviewsText.match(/[\d,]+/)?.[0] || '').replace(/,/g, ''), 10) || null;
  let emails = [];
  if (website && input.collectEmailsFromCompanyWebsites) {
    const companyPage = await context.newPage();
    try {
      await companyPage.goto(website, { waitUntil: 'domcontentloaded', timeout: input.pageTimeoutSecs * 1000 });
      await companyPage.waitForTimeout(input.delayMillis);
      emails = emailsFrom(`${await companyPage.locator('body').innerText().catch(() => '')} ${await companyPage.content().catch(() => '')}`);
      if (!emails.length) {
        const contact = await companyPage.locator('a[href]').evaluateAll(nodes => nodes.map(a => ({ href: a.href, text: a.innerText || '' })).find(v => /contact/i.test(v.text) && v.href.startsWith('http'))?.href || null).catch(() => null);
        if (contact) {
          await companyPage.goto(contact, { waitUntil: 'domcontentloaded', timeout: input.pageTimeoutSecs * 1000 });
          emails = emailsFrom(`${await companyPage.locator('body').innerText().catch(() => '')} ${await companyPage.content().catch(() => '')}`);
        }
      }
    } catch (error) { log.warning('Company website email visit failed', { website, message: error.message }); }
    finally { await companyPage.close(); }
  }
  return { companyName, website, websiteDomain: domainKey(website), email: emails[0] || null, allPublicEmails: emails, phone, address, category, rating, reviewsCount, googleMapsUrl: page.url(), searchTerm: item.searchTerm, location: item.location, sourceSearchUrl: item.sourceUrl, collectedAt: new Date().toISOString() };
}

let output = 0;
let visited = 0;
try {
  while (output < input.maximumNewCompanies && visited < input.maximumProfilesVisited) {
    if (!progress.pendingProfiles.length) {
      const search = progress.searchQueue.shift();
      if (!search) break;
      try { await discover(search); }
      catch (error) {
        search.retries = (search.retries || 0) + 1;
        if (search.retries <= 3) progress.searchQueue.unshift(search);
        await save();
        log.warning('Google Maps search failed', { url: search.url, retry: search.retries, message: error.message });
        if (/access challenge/i.test(error.message) && proxyConfiguration) { await rotate(); continue; }
        break;
      }
    }
    const item = progress.pendingProfiles.shift();
    if (!item) continue;
    const key = mapsPlaceKey(item.url);
    if (!key || processedProfiles.has(key)) { await save(); continue; }
    visited++;
    let row;
    try { row = await extractProfile(item); }
    catch (error) {
      item.retries = (item.retries || 0) + 1;
      if (item.retries <= 2) progress.pendingProfiles.push(item); else processedProfiles.add(key);
      await save();
      log.warning('Google Maps profile failed', { url: item.url, retry: item.retries, message: error.message });
      if (/access challenge/i.test(error.message) && proxyConfiguration) await rotate();
      continue;
    }
    processedProfiles.add(key);
    const domain = row.websiteDomain;
    if ((!domain && input.requireWebsite) || (domain && seenDomains.has(domain))) { await save(); continue; }
    if (domain) seenDomains.add(domain);
    await runDataset.pushData(row);
    await master.pushData(row);
    output++;
    progress.totalOutput++;
    await save();
    if (output % 10 === 0) log.info('Google Maps companies collected', { companiesOutputThisRun: output, profilesVisited: visited, pendingProfiles: progress.pendingProfiles.length, totalOutput: progress.totalOutput });
  }
} finally {
  await save();
  await browser.close().catch(() => {});
}
log.info('Google Maps campaign run completed', { campaignId, profilesVisited: visited, companiesOutputThisRun: output, pendingProfiles: progress.pendingProfiles.length, remainingSearches: progress.searchQueue.length, totalOutput: progress.totalOutput, masterDatasetId: master.id });
await Actor.exit();
