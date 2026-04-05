const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const patterns = {
  pnr: "Lufthansa Buchungscode:\\s*([A-Z0-9]{5,8})",
  arrivalCode: "<https://images\\.booking\\.lufthansa\\.com/destinations/\\s*([A-Z]{3})",
  flightNumber: "<https://images\\.booking\\.lufthansa\\.com/Icons/icon_lufthansa\\.jpg>\\s*([A-Z0-9 ]{4,8})",
  departureCode: "M\u00fcnchen Munich[^(]*\\(([A-Z]{3})\\)"
};

// Verify patterns work
for (const [k, v] of Object.entries(patterns)) {
  try { new RegExp(v); console.log('VALID:', k, '->', v); }
  catch(e) { console.log('INVALID:', k, e.message); }
}

p.parserTemplate.update({
  where: { id: '8841fff0-cfdd-4ec5-91e5-d9220ec834d6' },
  data: { patterns }
}).then(r => {
  console.log('\nSaved patterns:');
  const saved = r.patterns;
  for (const [k, v] of Object.entries(saved)) {
    console.log(`  ${k}: ${v}`);
  }
  p.$disconnect();
}).catch(e => { console.error(e.message); p.$disconnect(); });
