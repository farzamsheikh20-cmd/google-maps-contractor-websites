export const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

export function safeCampaignId(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'google-maps-contractors';
}

export function normalizeWebsite(value) {
  if (!value) return null;
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (/(^|\.)google\.[a-z.]+$|(^|\.)googleusercontent\.com$|(^|\.)gstatic\.com$/i.test(url.hostname)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|gclid|gbraid|wbraid|yclid|fbclid)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}

export function domainKey(value) {
  const url = normalizeWebsite(value);
  if (!url) return null;
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
}

export function mapsPlaceKey(value) {
  try {
    const url = new URL(value);
    const cid = url.searchParams.get('cid');
    if (cid) return `cid:${cid}`;
    const data = decodeURIComponent(url.href).match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1];
    if (data) return `data:${data.toLowerCase()}`;
    const place = decodeURIComponent(url.pathname).match(/\/maps\/place\/([^/]+)/i)?.[1];
    return place ? `place:${place.toLowerCase()}` : url.href;
  } catch { return clean(value); }
}

export function makeSearchUrl(term, location) {
  return `https://www.google.com/maps/search/${encodeURIComponent(`${clean(term)} ${clean(location)}`)}`;
}

export function emailsFrom(value) {
  return [...new Set((String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
    .map(v => v.toLowerCase()).filter(v => !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(v) && !/(example\.com|sentry\.io|wixpress\.com|cloudflare\.com)$/.test(v)))];
}
