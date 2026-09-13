/* Real Express/Prisma + loopback provider. Both servers use ephemeral ports.
 * The consumer uses the real frontend's 10s timeout budget. All data is synthetic.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { once } = require('node:events');
const dbUrl = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(dbUrl.hostname, '127.0.0.1');
assert.equal(dbUrl.port, '55439');
assert.equal(dbUrl.pathname, '/travstats_block11_probe_audit');
assert.equal(process.env.NODE_ENV, 'test');
const backend = path.resolve(__dirname, '../../.tmp/audit-fixes-20260910/backend');
const mod = (name) => require(path.join(backend, 'src', name));
const nativeFetch = global.fetch;
let providerPort;
let waitMs = 11000;
let rate = 0.9;
let providerCalls = 0;
let signalAttached = null;
let providerFinished;
const providerDone = new Promise((resolve) => { providerFinished = resolve; });
const provider = http.createServer((req, res) => {
  providerCalls++;
  setTimeout(() => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ amount: 1, base: 'USD', date: req.url.split('?')[0].slice(1), rates: { EUR: rate } }));
    providerFinished();
  }, waitMs);
});
global.fetch = (input, options) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, 'api.frankfurter.app', 'Unexpected outbound provider');
  signalAttached = Boolean(options?.signal);
  return nativeFetch('http://127.0.0.1:' + providerPort + url.pathname + url.search, options);
};
const { prisma } = mod('db.ts');
const app = mod('index.ts').default;
const { generateToken } = mod('utils/jwt.ts');
const { snapshotFx } = mod('services/fx/snapshot.ts');
const api = http.createServer(app);
const reports = [];
async function main() {
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  providerPort = provider.address().port;
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const user = await prisma.user.create({ data: {
    username: 'block11-fx-http-' + require('node:crypto').randomUUID(), passwordHash: 'synthetic-unusable',
  } });
  await prisma.userSettings.create({ data: { userId: user.id, data: {}, baseCurrency: 'EUR' } });
  const lodging = await prisma.lodging.create({ data: { userId: user.id, name: 'Synthetic slow FX hotel' } });
  const url = 'http://127.0.0.1:' + api.address().port + '/api/v1/lodging/' + lodging.id + '/stays';
  const body = { checkIn: '2025-02-03T00:00:00Z', checkOut: '2025-02-04T00:00:00Z', totalPrice: 100, currency: 'USD' };
  const headers = { 'Content-Type': 'application/json', Cookie: 'auth_token=' + generateToken(user.id) };
  const started = performance.now();
  let clientTimeout = false;
  try {
    await nativeFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  } catch (error) { clientTimeout = error.name === 'TimeoutError'; }
  const atTimeoutMs = Math.round(performance.now() - started);
  const atTimeout = await prisma.lodgingStay.count({ where: { userId: user.id } });
  assert.equal(clientTimeout, true);
  assert.equal(atTimeout, 0);
  assert.equal(signalAttached, false);
  await providerDone;
  let saved;
  for (let i = 0; i < 30 && !saved; i++) {
    saved = await prisma.lodgingStay.findFirst({ where: { userId: user.id } });
    if (!saved) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(saved);
  assert.equal(saved.totalPriceBase, 90);
  reports.push({ case: 'save_after_client_timeout', clientTimeoutMs: atTimeoutMs,
    recordsAtTimeout: atTimeout, recordPersistedAfterMs: Math.round(performance.now() - started),
    baseAmount: saved.totalPriceBase, providerAbortSignal: signalAttached });

  waitMs = 0;
  rate = 0;
  const zeroResponse = await nativeFetch(url, { method: 'POST', headers,
    body: JSON.stringify({ ...body, checkIn: '2025-02-05T00:00:00Z', checkOut: '2025-02-06T00:00:00Z' }) });
  assert.equal(zeroResponse.status, 201);
  const zeroPayload = await zeroResponse.json();
  assert.equal(zeroPayload.data.totalPriceBase, 0);
  assert.equal(zeroPayload.data.fxRate, 0);
  reports.push({ case: 'invalid_rate_persisted', status: zeroResponse.status,
    original: zeroPayload.data.totalPrice, converted: zeroPayload.data.totalPriceBase, rate: zeroPayload.data.fxRate });

  rate = 0.9;
  const today = new Date().toISOString().slice(0, 10);
  const before = providerCalls;
  const first = await snapshotFx({ amount: 100, currency: 'USD', date: today + 'T00:00:00Z' }, 'EUR');
  rate = 0.95;
  const second = await snapshotFx({ amount: 200, currency: 'USD', date: today + 'T00:00:00Z' }, 'EUR');
  assert.equal(first.status, 'snapshotted');
  assert.equal(second.status, 'snapshotted');
  assert.equal(second.snapshot.baseAmount, 180);
  assert.equal(providerCalls - before, 1);
  reports.push({ case: 'current_day_rate_frozen', date: today, publishedRateNow: rate,
    first: first.snapshot, newSnapshot: second.snapshot, providerCalls: providerCalls - before });
}
main().then(() => {
  fs.writeFileSync(path.join(__dirname, 'block11-fx-http.json'), JSON.stringify(reports, null, 2) + '\n');
  console.log(JSON.stringify(reports));
}).catch((error) => {
  console.error(error instanceof assert.AssertionError ? error.message : 'Audit harness failed: ' + error.name);
  process.exitCode = 1;
}).finally(async () => {
  global.fetch = nativeFetch;
  api.close();
  api.closeAllConnections();
  provider.close();
  provider.closeAllConnections();
  await prisma.$disconnect();
});
