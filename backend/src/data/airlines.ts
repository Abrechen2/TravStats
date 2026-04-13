/**
 * Comprehensive airline list for autocomplete suggestions.
 * ~150 airlines covering major, medium, and notable regional carriers.
 * Format: { iata: IATA code, name: display name }
 *
 * This is the single source of truth — used by the suggestions API
 * and by the flight lookup service (via AIRLINE_IATA_MAP export).
 */

export interface Airline {
  iata: string;
  name: string;
}

export const AIRLINES: Airline[] = [
  // ── Germany / Austria / Switzerland ─────────────────────────────────
  { iata: "LH", name: "Lufthansa" },
  { iata: "EW", name: "Eurowings" },
  { iata: "4Y", name: "Eurowings Discover" },
  { iata: "OS", name: "Austrian Airlines" },
  { iata: "LX", name: "SWISS" },
  { iata: "4U", name: "Germanwings" },
  { iata: "X3", name: "TUI fly Deutschland" },
  { iata: "EN", name: "Air Dolomiti" },
  { iata: "DE", name: "Condor" },
  { iata: "XQ", name: "SunExpress" },
  { iata: "LG", name: "Luxair" },
  { iata: "WK", name: "Edelweiss Air" },
  { iata: "HG", name: "Niki / Lauda" },

  // ── UK / Ireland ────────────────────────────────────────────────────
  { iata: "BA", name: "British Airways" },
  { iata: "U2", name: "easyJet" },
  { iata: "FR", name: "Ryanair" },
  { iata: "EI", name: "Aer Lingus" },
  { iata: "BE", name: "Flybe" },
  { iata: "LS", name: "Jet2" },
  { iata: "BY", name: "TUI Airways" },
  { iata: "VS", name: "Virgin Atlantic" },
  { iata: "T7", name: "TUI fly Belgium" },

  // ── France / Benelux ───────────────────────────────────────────────
  { iata: "AF", name: "Air France" },
  { iata: "KL", name: "KLM" },
  { iata: "SN", name: "Brussels Airlines" },
  { iata: "TO", name: "Transavia France" },
  { iata: "HV", name: "Transavia" },
  { iata: "BJ", name: "Nouvelair" },
  { iata: "SS", name: "Corsair" },

  // ── Iberian Peninsula ──────────────────────────────────────────────
  { iata: "IB", name: "Iberia" },
  { iata: "I2", name: "Iberia Express" },
  { iata: "VY", name: "Vueling" },
  { iata: "UX", name: "Air Europa" },
  { iata: "TP", name: "TAP Air Portugal" },
  { iata: "V7", name: "Volotea" },

  // ── Italy / Malta / Greece ─────────────────────────────────────────
  { iata: "AZ", name: "ITA Airways" },
  { iata: "NO", name: "Neos" },
  { iata: "KM", name: "Air Malta" },
  { iata: "A3", name: "Aegean Airlines" },
  { iata: "OA", name: "Olympic Air" },

  // ── Scandinavia / Baltics ──────────────────────────────────────────
  { iata: "SK", name: "SAS" },
  { iata: "AY", name: "Finnair" },
  { iata: "DY", name: "Norwegian" },
  { iata: "D8", name: "Norwegian Air Sweden" },
  { iata: "BT", name: "airBaltic" },
  { iata: "FI", name: "Icelandair" },
  { iata: "WW", name: "WOW air" },
  { iata: "RC", name: "Atlantic Airways" },

  // ── Eastern Europe ─────────────────────────────────────────────────
  { iata: "W6", name: "Wizz Air" },
  { iata: "OK", name: "Czech Airlines" },
  { iata: "LO", name: "LOT Polish Airlines" },
  { iata: "RO", name: "TAROM" },
  { iata: "OU", name: "Croatia Airlines" },
  { iata: "JP", name: "Adria Airways" },
  { iata: "JU", name: "Air Serbia" },
  { iata: "FB", name: "Bulgaria Air" },
  { iata: "PS", name: "Ukraine International Airlines" },
  { iata: "BV", name: "Blue Panorama" },

  // ── Turkey ─────────────────────────────────────────────────────────
  { iata: "TK", name: "Turkish Airlines" },
  { iata: "PC", name: "Pegasus Airlines" },
  { iata: "XQ", name: "SunExpress" },

  // ── Middle East ────────────────────────────────────────────────────
  { iata: "EK", name: "Emirates" },
  { iata: "QR", name: "Qatar Airways" },
  { iata: "EY", name: "Etihad Airways" },
  { iata: "GF", name: "Gulf Air" },
  { iata: "WY", name: "Oman Air" },
  { iata: "FZ", name: "flydubai" },
  { iata: "SV", name: "Saudia" },
  { iata: "RJ", name: "Royal Jordanian" },
  { iata: "ME", name: "Middle East Airlines" },
  { iata: "KU", name: "Kuwait Airways" },
  { iata: "IX", name: "Air India Express" },

  // ── Asia / Pacific ─────────────────────────────────────────────────
  { iata: "SQ", name: "Singapore Airlines" },
  { iata: "TR", name: "Scoot" },
  { iata: "CX", name: "Cathay Pacific" },
  { iata: "HX", name: "Hong Kong Airlines" },
  { iata: "JL", name: "Japan Airlines" },
  { iata: "NH", name: "ANA" },
  { iata: "MM", name: "Peach Aviation" },
  { iata: "KE", name: "Korean Air" },
  { iata: "OZ", name: "Asiana Airlines" },
  { iata: "TW", name: "T'way Air" },
  { iata: "TG", name: "Thai Airways" },
  { iata: "FD", name: "Thai AirAsia" },
  { iata: "MH", name: "Malaysia Airlines" },
  { iata: "AK", name: "AirAsia" },
  { iata: "GA", name: "Garuda Indonesia" },
  { iata: "JT", name: "Lion Air" },
  { iata: "CI", name: "China Airlines" },
  { iata: "BR", name: "EVA Air" },
  { iata: "CA", name: "Air China" },
  { iata: "MU", name: "China Eastern" },
  { iata: "CZ", name: "China Southern" },
  { iata: "HU", name: "Hainan Airlines" },
  { iata: "3U", name: "Sichuan Airlines" },
  { iata: "AI", name: "Air India" },
  { iata: "6E", name: "IndiGo" },
  { iata: "SG", name: "SpiceJet" },
  { iata: "VN", name: "Vietnam Airlines" },
  { iata: "VJ", name: "VietJet Air" },
  { iata: "PR", name: "Philippine Airlines" },
  { iata: "5J", name: "Cebu Pacific" },
  { iata: "PK", name: "Pakistan International" },

  // ── Oceania ────────────────────────────────────────────────────────
  { iata: "QF", name: "Qantas" },
  { iata: "JQ", name: "Jetstar Airways" },
  { iata: "VA", name: "Virgin Australia" },
  { iata: "NZ", name: "Air New Zealand" },
  { iata: "FJ", name: "Fiji Airways" },

  // ── North America ──────────────────────────────────────────────────
  { iata: "UA", name: "United Airlines" },
  { iata: "AA", name: "American Airlines" },
  { iata: "DL", name: "Delta Air Lines" },
  { iata: "WN", name: "Southwest Airlines" },
  { iata: "B6", name: "JetBlue" },
  { iata: "AS", name: "Alaska Airlines" },
  { iata: "HA", name: "Hawaiian Airlines" },
  { iata: "F9", name: "Frontier Airlines" },
  { iata: "NK", name: "Spirit Airlines" },
  { iata: "AC", name: "Air Canada" },
  { iata: "WS", name: "WestJet" },
  { iata: "PD", name: "Porter Airlines" },
  { iata: "Y4", name: "Volaris" },
  { iata: "AM", name: "Aeromexico" },

  // ── Latin America ──────────────────────────────────────────────────
  { iata: "LA", name: "LATAM Airlines" },
  { iata: "G3", name: "Gol" },
  { iata: "AD", name: "Azul" },
  { iata: "AR", name: "Aerolíneas Argentinas" },
  { iata: "CM", name: "Copa Airlines" },
  { iata: "AV", name: "Avianca" },
  { iata: "H2", name: "SKY Airline" },
  { iata: "JA", name: "JetSMART" },

  // ── Africa ─────────────────────────────────────────────────────────
  { iata: "ET", name: "Ethiopian Airlines" },
  { iata: "KQ", name: "Kenya Airways" },
  { iata: "SA", name: "South African Airways" },
  { iata: "MS", name: "EgyptAir" },
  { iata: "AT", name: "Royal Air Maroc" },
  { iata: "TU", name: "Tunisair" },
  { iata: "WB", name: "RwandAir" },
  { iata: "MK", name: "Air Mauritius" },

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
