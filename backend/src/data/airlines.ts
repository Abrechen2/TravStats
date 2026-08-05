/**
 * Curated airline override list (~147). No longer the runtime resolver
 * source — that is the `airlines` DB table, resolved via
 * `services/airlineCatalogCache.ts` + `utils/airlineNormalize.ts`. This
 * list now serves two roles:
 *   1. UNIONed into the seed by `data/openflights/buildAirlineSeed.ts` and
 *      WINS on a shared IATA, preserving the exact display names TravStats
 *      shows for common carriers.
 *   2. The cold-start fallback inside `airlineNormalize.ts` — used until
 *      `preloadAirlineCatalog()` has warmed the DB-backed cache, so lookups
 *      are correct even in a script or test that never preloaded it.
 */

export interface Airline {
  iata: string;
  icao?: string;
  name: string;
}

export const AIRLINES: Airline[] = [
  // ── Germany / Austria / Switzerland ─────────────────────────────────
  { iata: "LH", icao: "DLH", name: "Lufthansa" },
  { iata: "EW", icao: "EWG", name: "Eurowings" },
  { iata: "4Y", icao: "OCN", name: "Eurowings Discover" },
  { iata: "OS", icao: "AUA", name: "Austrian Airlines" },
  { iata: "LX", icao: "SWR", name: "SWISS" },
  { iata: "4U", icao: "GWI", name: "Germanwings" },
  { iata: "X3", icao: "TUI", name: "TUI fly Deutschland" },
  { iata: "EN", icao: "DLA", name: "Air Dolomiti" },
  { iata: "DE", icao: "CFG", name: "Condor" },
  { iata: "XQ", icao: "SXS", name: "SunExpress" },
  { iata: "LG", icao: "LGL", name: "Luxair" },
  { iata: "WK", icao: "EDW", name: "Edelweiss Air" },
  { iata: "HG", icao: "NLY", name: "Niki / Lauda" },

  // ── UK / Ireland ────────────────────────────────────────────────────
  { iata: "BA", icao: "BAW", name: "British Airways" },
  { iata: "U2", icao: "EZY", name: "easyJet" },
  { iata: "FR", icao: "RYR", name: "Ryanair" },
  { iata: "EI", icao: "EIN", name: "Aer Lingus" },
  { iata: "BE", icao: "BEE", name: "Flybe" },
  { iata: "LS", icao: "EXS", name: "Jet2" },
  { iata: "BY", icao: "TOM", name: "TUI Airways" },
  { iata: "VS", icao: "VIR", name: "Virgin Atlantic" },
  { iata: "T7", icao: "TUI", name: "TUI fly Belgium" },

  // ── France / Benelux ───────────────────────────────────────────────
  { iata: "AF", icao: "AFR", name: "Air France" },
  { iata: "KL", icao: "KLM", name: "KLM" },
  { iata: "SN", icao: "BEL", name: "Brussels Airlines" },
  { iata: "TO", icao: "TVF", name: "Transavia France" },
  { iata: "HV", icao: "TRA", name: "Transavia" },
  { iata: "BJ", icao: "LBT", name: "Nouvelair" },
  { iata: "SS", icao: "CRL", name: "Corsair" },

  // ── Iberian Peninsula ──────────────────────────────────────────────
  { iata: "IB", icao: "IBE", name: "Iberia" },
  { iata: "I2", icao: "IBS", name: "Iberia Express" },
  { iata: "VY", icao: "VLG", name: "Vueling" },
  { iata: "UX", icao: "AEA", name: "Air Europa" },
  { iata: "TP", icao: "TAP", name: "TAP Air Portugal" },
  { iata: "V7", icao: "VOE", name: "Volotea" },

  // ── Italy / Malta / Greece ─────────────────────────────────────────
  { iata: "AZ", icao: "ITY", name: "ITA Airways" },
  { iata: "NO", icao: "NOS", name: "Neos" },
  { iata: "KM", icao: "AMC", name: "Air Malta" },
  { iata: "A3", icao: "AEE", name: "Aegean Airlines" },
  { iata: "OA", icao: "OAL", name: "Olympic Air" },

  // ── Scandinavia / Baltics ──────────────────────────────────────────
  { iata: "SK", icao: "SAS", name: "SAS" },
  { iata: "AY", icao: "FIN", name: "Finnair" },
  { iata: "DY", icao: "NAX", name: "Norwegian" },
  { iata: "D8", icao: "NSZ", name: "Norwegian Air Sweden" },
  { iata: "BT", icao: "BTI", name: "airBaltic" },
  { iata: "FI", icao: "ICE", name: "Icelandair" },
  { iata: "WW", icao: "WOW", name: "WOW air" },
  { iata: "RC", icao: "FLI", name: "Atlantic Airways" },

  // ── Eastern Europe ─────────────────────────────────────────────────
  { iata: "W6", icao: "WZZ", name: "Wizz Air" },
  { iata: "OK", icao: "CSA", name: "Czech Airlines" },
  { iata: "LO", icao: "LOT", name: "LOT Polish Airlines" },
  { iata: "RO", icao: "ROT", name: "TAROM" },
  { iata: "OU", icao: "CTN", name: "Croatia Airlines" },
  { iata: "JP", icao: "ADR", name: "Adria Airways" },
  { iata: "JU", icao: "ASL", name: "Air Serbia" },
  { iata: "FB", icao: "LZB", name: "Bulgaria Air" },
  { iata: "PS", icao: "AUI", name: "Ukraine International Airlines" },
  { iata: "BV", icao: "BPA", name: "Blue Panorama" },

  // ── Turkey ─────────────────────────────────────────────────────────
  { iata: "TK", icao: "THY", name: "Turkish Airlines" },
  { iata: "PC", icao: "PGT", name: "Pegasus Airlines" },
  { iata: "XQ", icao: "SXS", name: "SunExpress" },

  // ── Middle East ────────────────────────────────────────────────────
  { iata: "EK", icao: "UAE", name: "Emirates" },
  { iata: "QR", icao: "QTR", name: "Qatar Airways" },
  { iata: "EY", icao: "ETD", name: "Etihad Airways" },
  { iata: "GF", icao: "GFA", name: "Gulf Air" },
  { iata: "WY", icao: "OMA", name: "Oman Air" },
  { iata: "FZ", icao: "FDB", name: "flydubai" },
  { iata: "SV", icao: "SVA", name: "Saudia" },
  { iata: "RJ", icao: "RJA", name: "Royal Jordanian" },
  { iata: "ME", icao: "MEA", name: "Middle East Airlines" },
  { iata: "KU", icao: "KAC", name: "Kuwait Airways" },
  { iata: "IX", icao: "AXB", name: "Air India Express" },

  // ── Asia / Pacific ─────────────────────────────────────────────────
  { iata: "SQ", icao: "SIA", name: "Singapore Airlines" },
  { iata: "TR", icao: "TGW", name: "Scoot" },
  { iata: "CX", icao: "CPA", name: "Cathay Pacific" },
  { iata: "HX", icao: "CRK", name: "Hong Kong Airlines" },
  { iata: "JL", icao: "JAL", name: "Japan Airlines" },
  { iata: "NH", icao: "ANA", name: "ANA" },
  { iata: "MM", icao: "APJ", name: "Peach Aviation" },
  { iata: "KE", icao: "KAL", name: "Korean Air" },
  { iata: "OZ", icao: "AAR", name: "Asiana Airlines" },
  { iata: "TW", icao: "TWB", name: "T'way Air" },
  { iata: "TG", icao: "THA", name: "Thai Airways" },
  { iata: "FD", icao: "AIQ", name: "Thai AirAsia" },
  { iata: "MH", icao: "MAS", name: "Malaysia Airlines" },
  { iata: "AK", icao: "AXM", name: "AirAsia" },
  { iata: "GA", icao: "GIA", name: "Garuda Indonesia" },
  { iata: "JT", icao: "LNI", name: "Lion Air" },
  { iata: "CI", icao: "CAL", name: "China Airlines" },
  { iata: "BR", icao: "EVA", name: "EVA Air" },
  { iata: "CA", icao: "CCA", name: "Air China" },
  { iata: "MU", icao: "CES", name: "China Eastern" },
  { iata: "CZ", icao: "CSN", name: "China Southern" },
  { iata: "HU", icao: "CHH", name: "Hainan Airlines" },
  { iata: "3U", icao: "CSC", name: "Sichuan Airlines" },
  { iata: "AI", icao: "AIC", name: "Air India" },
  { iata: "6E", icao: "IGO", name: "IndiGo" },
  { iata: "SG", icao: "SEJ", name: "SpiceJet" },
  { iata: "VN", icao: "HVN", name: "Vietnam Airlines" },
  { iata: "VJ", icao: "VJC", name: "VietJet Air" },
  { iata: "PR", icao: "PAL", name: "Philippine Airlines" },
  { iata: "5J", icao: "CEB", name: "Cebu Pacific" },
  { iata: "PK", icao: "PIA", name: "Pakistan International" },

  // ── Oceania ────────────────────────────────────────────────────────
  { iata: "QF", icao: "QFA", name: "Qantas" },
  { iata: "JQ", icao: "JST", name: "Jetstar Airways" },
  { iata: "VA", icao: "VOZ", name: "Virgin Australia" },
  { iata: "NZ", icao: "ANZ", name: "Air New Zealand" },
  { iata: "FJ", icao: "FJI", name: "Fiji Airways" },

  // ── North America ──────────────────────────────────────────────────
  { iata: "UA", icao: "UAL", name: "United Airlines" },
  { iata: "AA", icao: "AAL", name: "American Airlines" },
  { iata: "DL", icao: "DAL", name: "Delta Air Lines" },
  { iata: "WN", icao: "SWA", name: "Southwest Airlines" },
  { iata: "B6", icao: "JBU", name: "JetBlue" },
  { iata: "AS", icao: "ASA", name: "Alaska Airlines" },
  { iata: "HA", icao: "HAL", name: "Hawaiian Airlines" },
  { iata: "F9", icao: "FFT", name: "Frontier Airlines" },
  { iata: "NK", icao: "NKS", name: "Spirit Airlines" },
  { iata: "AC", icao: "ACA", name: "Air Canada" },
  { iata: "WS", icao: "WJA", name: "WestJet" },
  { iata: "PD", icao: "POE", name: "Porter Airlines" },
  { iata: "Y4", icao: "VOI", name: "Volaris" },
  { iata: "AM", icao: "AMX", name: "Aeromexico" },

  // ── Latin America ──────────────────────────────────────────────────
  { iata: "LA", icao: "LAN", name: "LATAM Airlines" },
  { iata: "G3", icao: "GLO", name: "Gol" },
  { iata: "AD", icao: "AZU", name: "Azul" },
  { iata: "AR", icao: "ARG", name: "Aerolíneas Argentinas" },
  { iata: "CM", icao: "CMP", name: "Copa Airlines" },
  { iata: "AV", icao: "AVA", name: "Avianca" },
  { iata: "H2", icao: "SKU", name: "SKY Airline" },
  { iata: "JA", icao: "JAT", name: "JetSMART" },

  // ── Africa ─────────────────────────────────────────────────────────
  { iata: "ET", icao: "ETH", name: "Ethiopian Airlines" },
  { iata: "KQ", icao: "KQA", name: "Kenya Airways" },
  { iata: "SA", icao: "SAA", name: "South African Airways" },
  { iata: "MS", icao: "MSR", name: "EgyptAir" },
  { iata: "AT", icao: "RAM", name: "Royal Air Maroc" },
  { iata: "TU", icao: "TAR", name: "Tunisair" },
  { iata: "WB", icao: "RWD", name: "RwandAir" },
  { iata: "MK", icao: "MAU", name: "Air Mauritius" },

  // ── Rail / Bus / Ferry (for codeshare / intermodal) ────────────────
  { iata: "DB", name: "Deutsche Bahn" },
  { iata: "FLX", name: "FlixTrain" },
  { iata: "FLB", name: "Flixbus" },
  { iata: "OBB", name: "ÖBB" },
  { iata: "SBB", name: "SBB" },
  { iata: "EUR", name: "Eurostar" },
  { iata: "TGV", name: "TGV (SNCF)" },
  { iata: "ICE", name: "ICE (DB)" },
];

/**
 * Build a Record<string, string> from IATA code to airline name.
 * Used by flightLookup.ts for reverse lookups.
 */
export const AIRLINE_IATA_MAP: Record<string, string> = Object.fromEntries(
  AIRLINES.map(a => [a.iata, a.name])
);

/**
 * Build a Record<string, string> from ICAO code to airline name. Not every
 * entry carries an ICAO code (the rail/bus/ferry intermodal rows don't have
 * one), so those are skipped.
 */
export const AIRLINE_ICAO_MAP: Record<string, string> = Object.fromEntries(
  AIRLINES.filter(a => a.icao).map(a => [a.icao as string, a.name])
);
