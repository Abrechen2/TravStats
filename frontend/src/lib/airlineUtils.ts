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

/**
 * Resolve a display-ready airline name from the stored airline field and
 * optionally the flight number. Normalizes inconsistent storage where some
 * flights hold the full name ("Lufthansa") and others only the IATA code
 * ("LH"). Fallback order:
 *   1. Stored airline: if it is a known 2-char IATA code, expand to full name
 *   2. Stored airline as-is (if non-empty, > 2 chars)
 *   3. IATA prefix of the flight number
 *   4. null
 */
export function resolveAirlineDisplay(
  airline: string | null | undefined,
  flightNumber?: string | null
): string | null {
  if (airline) {
    const trimmed = airline.trim();
    if (trimmed.length === 2) {
      const resolved = AIRLINE_IATA_MAP[trimmed.toUpperCase()];
      if (resolved) return resolved;
    }
    if (trimmed.length > 0) return trimmed;
  }
  if (flightNumber) {
    return getAirlineFromFlightNumber(flightNumber);
  }
  return null;
}
