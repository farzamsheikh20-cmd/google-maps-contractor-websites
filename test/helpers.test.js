import test from 'node:test';
import assert from 'node:assert/strict';
import { domainKey, emailsFrom, makeSearchUrl, mapsPlaceKey, normalizeWebsite, safeCampaignId } from '../src/helpers.js';

test('normalizes real websites and strips tracking', () => {
  assert.equal(domainKey('https://www.example.com/?utm_source=maps'), 'example.com');
  assert.equal(normalizeWebsite('https://google.com/maps/place/test'), null);
});
test('builds maps searches', () => assert.match(makeSearchUrl('general contractors', 'Los Angeles, California'), /google\.com\/maps\/search/));
test('creates stable place keys', () => assert.equal(mapsPlaceKey('https://www.google.com/maps?cid=123'), 'cid:123'));
test('filters false image emails', () => assert.deepEqual(emailsFrom('Hi Sales@Firm.com and logo@2x.png'), ['sales@firm.com']));
test('safe campaign id', () => assert.equal(safeCampaignId('LA General Contractors!'), 'la-general-contractors'));
