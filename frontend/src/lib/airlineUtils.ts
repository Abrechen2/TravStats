/**
 * IATA airline code → airline name mapping (subset of common carriers).
 * Mirrors the backend AIRLINE_IATA_MAP in flightLookup.ts.
 */
const AIRLINE_IATA_MAP: Record<string, string> = {
  // Germany / Austria / Switzerland
  LH: "Lufthansa",
  EW: "Eurowings",
  OS: "Austrian Airlines",
  LX: "SWISS",
  "4U": "Germanwings",
  X3: "TUI fly Deutschland",
  EN: "Air Dolomiti",
  // UK / Ireland
  BA: "British Airways",
  U2: "easyJet",
  FR: "Ryanair",
  EI: "Aer Lingus",
  BE: "Flybe",
  LS: "Jet2",
  BY: "TUI Airways",
  // France / Benelux / Iberia
  AF: "Air France",
  KL: "KLM",
  SN: "Brussels Airlines",
  TK: "Turkish Airlines",
  VY: "Vueling",
  IB: "Iberia",
  I2: "Iberia Express",
  UX: "Air Europa",
  TP: "TAP Air Portugal",
  // Scandinavia / Eastern Europe
  SK: "SAS",
  AY: "Finnair",
  DY: "Norwegian",
  W6: "Wizz Air",
  WZ: "Wizz Air",
  OK: "Czech Airlines",
  LO: "LOT Polish Airlines",
  RO: "TAROM",
  // Middle East
  EK: "Emirates",
  QR: "Qatar Airways",
  EY: "Etihad Airways",
  GF: "Gulf Air",
  WY: "Oman Air",
  FZ: "flydubai",
  // Asia / Pacific
  SQ: "Singapore Airlines",
  CX: "Cathay Pacific",
  JL: "Japan Airlines",
  NH: "ANA",
  KE: "Korean Air",
  OZ: "Asiana Airlines",
  TG: "Thai Airways",
  MH: "Malaysia Airlines",
  GA: "Garuda Indonesia",
  CI: "China Airlines",
  BR: "EVA Air",
  CA: "Air China",
  MU: "China Eastern",
  CZ: "China Southern",
  AI: "Air India",
  "6E": "IndiGo",
  // North America
  UA: "United Airlines",
  AA: "American Airlines",
  DL: "Delta Air Lines",
  WN: "Southwest Airlines",
  B6: "JetBlue",
  AS: "Alaska Airlines",
  AC: "Air Canada",
  WS: "WestJet",
  F9: "Frontier Airlines",
  NK: "Spirit Airlines",
  // Africa / Latin America / Others
  ET: "Ethiopian Airlines",
  KQ: "Kenya Airways",
  SA: "South African Airways",
  MS: "EgyptAir",
  LA: "LATAM Airlines",
  G3: "Gol",
  AR: "Aerolíneas Argentinas",
  AM: "Aeromexico",
  CM: "Copa Airlines",
  AV: "Avianca",
};

/**
 * Derive airline name from an IATA flight number prefix (first 2 characters).
 * Returns null if unknown.
 */
export function getAirlineFromFlightNumber(flightNumber: string): string | null {
  if (!flightNumber || flightNumber.length < 2) return null;
  const prefix = flightNumber.slice(0, 2).toUpperCase();
  return AIRLINE_IATA_MAP[prefix] ?? null;
}
