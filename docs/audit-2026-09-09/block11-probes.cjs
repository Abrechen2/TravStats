/* Standalone audit reproductions; run with the isolated backend's tsx/cjs hook.
 * DATABASE_URL must be the dedicated probe database. No real network is used.
 * Assertions pin observed defects and controls, not desired fixed behavior.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const dbUrl = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(dbUrl.hostname, '127.0.0.1');
assert.equal(dbUrl.port, '55439');
assert.equal(dbUrl.pathname, '/travstats_block11_probe_audit');
assert.equal(process.env.NODE_ENV, 'test');
const backend = path.resolve(__dirname, '../../.tmp/audit-fixes-20260910/backend');
const mod = (name) => require(path.join(backend, 'src', name));
process.env.PHOTON_URL = 'http://photon.invalid';
process.env.NOMINATIM_URL = 'http://nominatim.invalid';
process.env.GOOGLE_PLACES_API_KEY = 'synthetic-probe-only';
let dispatch = async () => { throw new Error('Unexpected provider request'); };
const originalFetch = global.fetch;
global.fetch = (input, options) => dispatch(new URL(String(input)), options);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const photonHit = (lat, lon, city = 'Rom', country = 'Italien') => json({
  features: [{ properties: { name: 'Synthetic Hotel', city, country, osm_value: 'hotel' },
    geometry: { coordinates: [lon, lat] } }],
});
const googleHit = (city, country, code, type = 'hotel') => json({ places: [{
  displayName: { text: 'Synthetic Hotel' }, primaryType: type,
  location: { latitude: 52.52, longitude: 13.405 },
  addressComponents: [{ longText: city, types: ['locality'] },
    { longText: country, shortText: code, types: ['country'] }],
}] });
const { prisma } = mod('db.ts');
const geo = mod('services/lodging/geocodeBackfill.ts');
const nominatim = mod('services/geo/nominatim.ts');
const { snapshotFx } = mod('services/fx/snapshot.ts');
const { getRate } = mod('services/fx/frankfurter.ts');
const { getCdnRate } = mod('services/fx/currencyApiCdn.ts');
const { chainFromWebsite } = mod('services/lodging/chainFromWebsite.ts');
const findings = [];
const users = [];
async function lodging(label, extra = {}) {
  const user = await prisma.user.create({ data: {
    username: 'block11-' + label + '-' + require('node:crypto').randomUUID(), passwordHash: 'synthetic-unusable',
  } });
  users.push(user.id);
  return prisma.lodging.create({ data: {
    userId: user.id, name: 'Synthetic ' + label, city: 'Berlin', country: 'Deutschland', ...extra,
  } });
}
async function main() {
  // Same-name OSM hotel in a contradictory city/country is persisted.
  let row = await lodging('photon-mismatch');
  dispatch = async (url) => {
    assert.equal(url.hostname, 'photon.invalid');
    return photonHit(41.9, 12.5);
  };
  let result = await geo.backfillMissingCoordinates(row.userId);
  let saved = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(result.filled, 1);
  assert.equal(saved.city, 'Berlin');
  assert.equal(saved.lat, 41.9);
  findings.push({ case: 'photon_contradiction', result, stored: { city: saved.city, country: saved.country, lat: saved.lat, lon: saved.lon } });

  // Provider answer arrives after a deliberate manual coordinate correction.
  row = await lodging('concurrent-pin');
  let release;
  let started;
  const reached = new Promise((resolve) => { started = resolve; });
  dispatch = async (url) => {
    assert.equal(url.hostname, 'photon.invalid');
    started();
    return new Promise((resolve) => { release = () => resolve(photonHit(41.9, 12.5)); });
  };
  const pending = geo.backfillMissingCoordinates(row.userId);
  await reached;
  await prisma.lodging.update({ where: { id: row.id }, data: { lat: 52.52, lon: 13.405 } });
  const manual = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(manual.lat, 52.52);
  release();
  result = await pending;
  saved = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(saved.lat, 41.9);
  findings.push({ case: 'manual_pin_overwritten', result, manual: [manual.lat, manual.lon], after: [saved.lat, saved.lon] });

  // Correct CN/China answer is refused because the guard compares text spellings.
  row = await lodging('country-code', { city: 'Peking', country: 'CN' });
  dispatch = async (url) => {
    if (url.hostname === 'photon.invalid') return json({ features: [] });
    if (url.hostname === 'nominatim.invalid') return json([]);
    assert.equal(url.hostname, 'places.googleapis.com');
    return googleHit('Peking', 'China', 'CN');
  };
  result = await geo.backfillMissingCoordinates(row.userId);
  saved = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(result.filled, 0);
  assert.equal(saved.lat, null);
  const subject = { name: 'Synthetic', type: 'hotel', chainId: null, address: null, city: '東京', country: 'Japan' };
  const match = { lat: 34.69, lon: 135.5, source: 'google', city: '大阪', countryName: 'Japan' };
  assert.equal(geo.agreesWithRow(subject, match), true);
  const controls = {
    sameCountryName: geo.agreesWithRow({ ...subject, city: 'Peking', country: 'China' }, { ...match, city: 'Peking', countryName: 'China' }),
    latinMismatch: geo.agreesWithRow({ ...subject, city: 'Berlin', country: 'Deutschland' }, { ...match, city: 'Rom', countryName: 'Italien' }),
  };
  assert.deepEqual(controls, { sameCountryName: true, latinMismatch: false });
  findings.push({ case: 'place_guard_vocabulary', correctIsoHitFilled: result.filled, tokyoVsOsakaAccepted: true, controls });

  // Filling coordinates also replaces a user's chosen lodging type.
  row = await lodging('manual-type', { type: 'campsite' });
  dispatch = async (url) => {
    if (url.hostname === 'photon.invalid') return json({ features: [] });
    if (url.hostname === 'nominatim.invalid') return json([]);
    assert.equal(url.hostname, 'places.googleapis.com');
    return googleHit('Berlin', 'Deutschland', 'DE');
  };
  result = await geo.backfillMissingCoordinates(row.userId);
  saved = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(result.filled, 1);
  assert.equal(saved.type, 'hotel');
  findings.push({ case: 'manual_type_overwritten', before: 'campsite', after: saved.type });

  // Transient HTTP 503 is cached as an authoritative miss in both directions.
  let calls = 0;
  dispatch = async (url) => {
    assert.equal(url.hostname, 'nominatim.invalid');
    calls++;
    return calls === 1 ? json({}, 503) : json([{ lat: '52.52', lon: '13.405' }]);
  };
  const address = { name: 'Synthetic outage forward', city: 'Berlin' };
  const first = await nominatim.geocodeAddress(address);
  const retry = await nominatim.geocodeAddress(address);
  assert.equal(first, null);
  assert.equal(retry, null);
  assert.equal(calls, 1);
  const differentQuery = await nominatim.geocodeAddress({ ...address, name: 'Synthetic recovered control' });
  assert.equal(differentQuery.lat, 52.52);
  findings.push({ case: 'http_error_negative_cache_forward', first, retry, callsIncludingControl: calls, control: differentQuery });
  calls = 0;
  dispatch = async () => {
    calls++;
    return calls === 1 ? json({}, 503) : json({ address: { city: 'Berlin', country: 'Deutschland' } });
  };
  const revFirst = await nominatim.reverseGeocode(51.12345, 12.6789);
  const revRetry = await nominatim.reverseGeocode(51.12345, 12.6789);
  assert.equal(revFirst, null);
  assert.equal(revRetry, null);
  assert.equal(calls, 1);
  const revControl = await nominatim.reverseGeocode(52.12345, 12.6789);
  assert.equal(revControl.city, 'Berlin');
  findings.push({ case: 'http_error_negative_cache_reverse', first: revFirst, retry: revRetry, callsIncludingControl: calls, control: revControl });

  // Provider metadata is discarded; the snapshot labels the requested day.
  dispatch = async (url) => {
    assert.equal(url.hostname, 'api.frankfurter.app');
    return json({ amount: 1, base: 'USD', date: '2026-09-04', rates: { EUR: 0.9 } });
  };
  const snapshot = await snapshotFx({ amount: 100, currency: 'USD', date: '2026-09-05T00:00:00Z' }, 'EUR');
  assert.equal(snapshot.status, 'snapshotted');
  assert.equal(snapshot.snapshot.rateDate.toISOString().slice(0, 10), '2026-09-05');
  findings.push({ case: 'fx_provider_day_discarded', providerDate: '2026-09-04', snapshot: snapshot.snapshot });

  // A finite but impossible rate is accepted and cached by both providers.
  calls = 0;
  dispatch = async () => { calls++; return json({ rates: { EUR: 0 } }); };
  const zeroRate = await getRate('USD', 'EUR', '2025-03-11');
  dispatch = async () => { calls++; return json({ rates: { EUR: 0.9 } }); };
  const zeroCached = await getRate('USD', 'EUR', '2025-03-11');
  assert.equal(zeroRate.rate, 0);
  assert.equal(zeroCached.rate, 0);
  assert.equal(calls, 1);
  dispatch = async () => json({ date: '2025-03-12', egp: { eur: -0.1 } });
  const negativeRate = await getCdnRate('EGP', 'EUR', '2025-03-12');
  assert.equal(negativeRate.rate, -0.1);
  findings.push({ case: 'invalid_fx_rates', zeroRate, zeroCached, negativeRate });

  // Observe options directly and let a controlled provider settle afterwards.
  const optionsSeen = [];
  dispatch = async (url, options) => {
    optionsSeen.push({ provider: url.hostname, hasAbortSignal: Boolean(options?.signal) });
    return json(url.hostname === 'api.frankfurter.app' ? { rates: { EUR: 0.9 } } : { egp: { eur: 0.02 } });
  };
  await getRate('USD', 'EUR', '2025-03-13');
  await getCdnRate('EGP', 'EUR', '2025-03-13');
  assert.ok(optionsSeen.every((o) => !o.hasAbortSignal));
  findings.push({ case: 'fx_deadline_options', optionsSeen });

  // Domain matching handles subdomains and rejects lookalikes/userinfo traps.
  const chains = ['https://all.accor.com/hotel', 'https://hilton.com.evil.invalid/', 'https://hilton.com@evil.invalid/', 'not a URL']
    .map((input) => ({ input, chain: chainFromWebsite(input) }));
  assert.deepEqual(chains.map((c) => c.chain), ['Accor', null, null, null]);
  findings.push({ case: 'chain_domain_controls', chains });
}
main().then(() => {
  fs.writeFileSync(path.join(__dirname, 'block11-probes.json'), JSON.stringify(findings, null, 2) + '\n');
  console.log(JSON.stringify({ completedCases: findings.length, cases: findings.map((f) => f.case) }));
}).catch((error) => {
  console.error(error instanceof assert.AssertionError ? error.message : 'Audit harness failed: ' + error.name);
  process.exitCode = 1;
}).finally(async () => {
  global.fetch = originalFetch;
  await prisma.$disconnect();
});
