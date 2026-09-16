/* Independent audit probes against a frozen commit. Synthetic fixtures only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const backend = path.resolve(__dirname, '../../.tmp/audit-round2-9678e6cd/backend');
assert.equal(process.env.NODE_ENV, 'test');
const dbUrl = new URL(process.env.DATABASE_URL);
assert.equal(dbUrl.hostname, '127.0.0.1');
assert.equal(dbUrl.port, '55439');
assert.equal(dbUrl.pathname, '/travstats_block12_probe_audit');
require(path.join(backend, 'node_modules/tsx/dist/cjs/index.cjs'));
const { parseLodgingBookingText } = require(path.join(backend, 'src/services/lodging/lodgingBookingParser.ts'));
const { normalizeBoard } = require(path.join(backend, 'src/services/lodging/lodgingFieldNormalization.ts'));
const { parseBookingComEmail } = require(path.join(backend, 'src/services/lodging/bookingComTemplate.ts'));
const { prisma } = require(path.join(backend, 'src/db.ts'));
const results = [];
const booking = (name, price, start = '2026-01-01', end = '2026-01-03', currency = 'EUR') => ({
  hotelName: name, totalPrice: price, pricePerNight: null, checkIn: start, checkOut: end,
  currency, city: 'Auditstadt', country: 'Deutschland', roomCategory: 'Standard',
  confirmationNumber: 'SYNTHETIC-AUDIT', board: 'none', adults: 1, children: 0,
});
async function parseCase(name, source, bookings, mode = 'normal') {
  let generateHits = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'audit' }] })); return; }
    generateHits++;
    if (mode === 'trickle') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(' ');
      const timer = setInterval(() => res.write(' '), 15);
      res.on('close', () => clearInterval(timer));
      return;
    }
    if (mode === 'abort') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '9999' });
      res.write('{');
      setTimeout(() => res.destroy(), 30);
      return;
    }
    res.end(JSON.stringify({ response: JSON.stringify({ bookings }) }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const started = Date.now();
  try {
    const result = await parseLodgingBookingText(source, { url: `http://127.0.0.1:${server.address().port}`, model: 'audit' });
    assert.equal(generateHits, 1, 'the actual model-normalization path must have run');
    results.push({ name, elapsedMs: Date.now() - started, parserUsed: result.parserUsed,
      bookings: result.bookings.map(b => ({ name: b.hotelName, checkIn: b.checkIn, totalPrice: b.totalPrice,
        currency: b.currency, board: b.board, missing: b.missing })), fallback: result.fallbackReason ?? null });
    return result;
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
async function main() {
  const distinct = await parseCase('distinct hotels: original AUD-050 control',
    'Hotel Alpha\n2026-01-01 to 2026-01-03\nTotal price: EUR 100.00\nHotel Beta\n2026-02-01 to 2026-02-03\nTotal price: EUR 500.00',
    [booking('Hotel Alpha',100),booking('Hotel Beta',500,'2026-02-01','2026-02-03')]);
  assert.deepEqual(distinct.bookings.map(b => b.totalPrice), [100,500]);
  await parseCase('same hotel, two date ranges: independent AUD-050 residual',
    'Hotel Alpha\n2026-01-01 to 2026-01-03\nTotal price: EUR 100.00\nHotel Alpha\n2026-02-01 to 2026-02-03\nTotal price: EUR 500.00',
    [booking('Hotel Alpha',100),booking('Hotel Alpha',500,'2026-02-01','2026-02-03')]);
  const fx = await parseCase('known currency conversion: original AUD-050 control',
    'Hotel Alpha\nTotal price: EUR 100.00\nOriginal room fee AED 400.00', [booking('Hotel Alpha',400,undefined,undefined,'AED')]);
  assert.equal(fx.bookings[0].totalPrice,400);
  const nil = await parseCase('string null: AUD-051 control', 'Hotel Alpha booking without a printed price', [booking('Hotel Alpha','null')]);
  assert.equal(nil.bookings[0].totalPrice,null);
  assert.ok(nil.bookings[0].missing.includes('totalPrice'));
  const template = parseBookingComEmail('Ihre Buchung ist bestätigt: Audit Hotel',
    'https://booking.com\nBestätigungsnummer: 1234567890\nAnreise\t Montag, 5. Januar 2026 (ab 15:00)\nAbreise\t Mittwoch, 7. Januar 2026 (bis 11:00)\nIhre Buchung\t 2 Nächte, Standardzimmer\nLage\t Musterweg 1, 12345 Auditstadt, Deutschland\nGesamtpreis\nUS$ 135.87');
  assert.ok(template);
  assert.equal(template.totalPrice,135.87);
  results.push({ name:'template decimal point: AUD-052 control',totalPrice:template.totalPrice,currency:template.currency });
  const board = ['No breakfast included','Breakfast not included','Ohne Frühstück','Breakfast included','Breakfast available for an extra charge'].map(input=>({input,board:normalizeBoard(input)}));
  assert.deepEqual(board.map(b=>b.board),['none','none','none','breakfast',null]);
  results.push({name:'meal exclusion: AUD-053 controls',board});
  process.env.LODGING_OLLAMA_TIMEOUT_MS = '120';
  for (const mode of ['trickle','abort']) {
    const result = await parseCase(`deadline: AUD-058 ${mode}`, 'Hotel Alpha booking', [], mode);
    assert.equal(result.parserUsed,'none');
  }
}
main().then(async()=>{
  await prisma.$disconnect();
  fs.writeFileSync(path.join(__dirname,'block12-parser-probes.json'),JSON.stringify({commit:'9678e6cd',results},null,2));
  console.log(JSON.stringify(results));
}).catch(async error=>{
  await prisma.$disconnect();
  fs.writeFileSync(path.join(__dirname,'block12-parser-probes.json'),JSON.stringify({commit:'9678e6cd',results,error:String(error)},null,2));
  console.error(error.message); process.exitCode=1;
});
