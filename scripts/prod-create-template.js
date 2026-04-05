const {PrismaClient} = require('./backend/node_modules/@prisma/client');
const p = new PrismaClient();
const patterns = {
  pnr: "Lufthansa Buchungscode:\\s*([A-Z0-9]{5,8})",
  arrivalCode: "<https://images\\.booking\\.lufthansa\\.com/destinations/\\s*([A-Z]{3})",
  flightNumber: "<https://images\\.booking\\.lufthansa\\.com/Icons/icon_lufthansa\\.jpg>\\s*([A-Z0-9 ]{4,8})",
  departureCode: "M\u00fcnchen Munich[^(]*\\(([A-Z]{3})\\)"
};
const fingerprint = {
  senderDomains: ["newsletter2.lufthansa.com"],
  subjectPatterns: ["Buchungsdetails Abflug:"],
  bodyMarkers: ["Buchungscode", "Durchgeführt von", "IATA-Code des Abflughafens"]
};
p.parserTemplate.create({
  data: {
    userId: "4c1244d1-8a55-4f16-ba01-fd20702bc23f",
    name: "Lufthansa Buchungsdetails (abgeleitet am 4.4.2026)",
    status: "active",
    fingerprint: fingerprint,
    patterns: patterns,
    stats: { matchCount: 0, successRate: 0 }
  }
}).then(r => { console.log("Created:", r.id); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); });
