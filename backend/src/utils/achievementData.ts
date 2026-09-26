/**
 * Reference data for v1.1 achievement expansion.
 *
 * Kept separate from utils/achievements.ts so the lookup tables stay
 * easy to audit and extend without churning the main check logic.
 *
 * Matching is always UPPERCASE + normalized (aircraft via normalizeAircraft,
 * airlines via ICAO / IATA code or upper-cased display name).
 */

import {
  ALLIANCE_IDS,
  ALLIANCE_MEMBERS,
  allianceOfIata,
  type AllianceId,
} from "../data/airlineAlliances";

/** IATA codes of airports on ocean-island territories (not exhaustive). */
export const ISLAND_AIRPORTS: ReadonlySet<string> = new Set([
  // Atlantic
  "KEF",
  "RKV",
  "AKU",
  "FAE",
  "AGP",
  "TFN",
  "TFS",
  "GCM",
  "MAD",
  // Balearic / Mediterranean
  "PMI",
  "IBZ",
  "MAH",
  "MLA",
  "HER",
  "RHO",
  "CFU",
  "SKG",
  "PFO",
  "LCA",
  // Canary
  "LPA",
  "FUE",
  "ACE",
  // Caribbean
  "SJU",
  "SDQ",
  "HAV",
  "MBJ",
  "POP",
  "NAS",
  "FDF",
  "PTP",
  "CUR",
  "AUA",
  // Pacific
  "HNL",
  "OGG",
  "KOA",
  "LIH",
  "GUM",
  "NAN",
  "APW",
  "PPG",
  // Indian Ocean
  "MLE",
  "SEZ",
  "MRU",
  "CMB",
  "PEN",
  "LGK",
  // North Sea / British Isles
  "JER",
  "GCI",
  "IOM",
  // Asian islands
  "NRT",
  "HND",
  "KIX",
  "CTS",
  "OKA",
  "TPE",
  "TSA",
  "HKG",
  "MFM",
  "DPS",
  "CGK",
  "SUB",
  "DAD",
  "SGN",
]);

/** Airports at ≥2500 m elevation. */
export const HIGH_ALTITUDE_AIRPORTS: ReadonlySet<string> = new Set([
  "LPB", // La Paz / El Alto, 4061 m — highest commercial
  "CUZ", // Cusco, 3399 m
  "JUL", // Juliaca, 3826 m
  "QIT", // Tolca, 2580 m
  "TLC", // Toluca, 2580 m
  "UIO", // Quito, 2800 m
  "KTM", // Kathmandu, 1338 m — NOT high-altitude strictly; kept out
  "ADD", // Addis Ababa, 2355 m — borderline; kept out
  "BOG", // Bogotá, 2548 m
  "MEX", // Mexico City, 2230 m — borderline; kept out
  "ELM", // …
  "SRE", // Sucre, 2906 m
  "PUQ", // Punta Arenas — no
  "LXA", // Lhasa, 3570 m
  "DIQ", // Diqing, 3288 m
  "BPX", // Bamda, 4334 m
  "JKH", // Chios — no
  "DAM", // Damascus, 616 m — no
]);

/**
 * Country ISO codes considered "micro-states" for the collection achievement.
 * Uses values our airport table emits (ISO alpha-2 uppercase where available).
 */
export const MICRO_STATES: ReadonlySet<string> = new Set([
  "LU",
  "Luxembourg",
  "MT",
  "Malta",
  "MC",
  "Monaco",
  "SM",
  "San Marino",
  "LI",
  "Liechtenstein",
  "AD",
  "Andorra",
  "VA",
  "Vatican City",
]);

/** Scandinavian capital airports for the Grand Tour. */
export const SCANDINAVIA_AIRPORTS: ReadonlySet<string> = new Set([
  "OSL",
  "CPH",
  "ARN",
  "HEL",
  "KEF",
]);

/** Historic pilgrimage centres. */
export const PILGRIM_AIRPORTS: ReadonlySet<string> = new Set([
  "FCO", // Rome / Vatican
  "CIA", // Rome Ciampino
  "JED", // Jeddah (gateway to Mecca)
  "MED", // Medina
  "KTM", // Kathmandu
  "GAY", // Gaya / Bodh Gaya
  "TLV", // Tel Aviv (Jerusalem gateway)
]);

/** Normalized aircraft substrings that count as wide-body. */
export const WIDE_BODY_SUBSTRINGS: readonly string[] = [
  "A380",
  "A350",
  "A330",
  "A340",
  "B747",
  "747",
  "B777",
  "777",
  "B787",
  "787",
  "B767",
  "767",
  "IL96",
];

/** Normalized aircraft substrings that count as turbo-prop. */
export const TURBO_PROP_SUBSTRINGS: readonly string[] = [
  "ATR",
  "DASH",
  "DHC",
  "Q400",
  "SAAB",
  "EMB-120",
  "E120",
  "AN-24",
  "AN24",
];

/** Normalized aircraft substrings that count as the Queen of the Skies. */
export const JUMBO_SUBSTRINGS: readonly string[] = ["B747", "747", "BOEING 747"];

/** Boeing 777 family — the Jackpot achievement wants flight number 777 ON a 777. */
export const B777_SUBSTRINGS: readonly string[] = ["B777", "777", "BOEING 777"];

/**
 * Display names the logbook stores for alliance members, mapped to their IATA
 * designator. Membership itself is NOT decided here: it is read from
 * `data/airlineAlliances.ts`, the one list the loyalty pickers read too
 * (forgejo#133). A name only says which carrier is meant.
 */
const ALLIANCE_NAME_TO_IATA: Readonly<Record<string, string>> = {
  LUFTHANSA: "LH",
  UNITED: "UA",
  SWISS: "LX",
  AUSTRIAN: "OS",
  "AIR CANADA": "AC",
  "ALL NIPPON": "NH",
  ANA: "NH",
  "SINGAPORE AIRLINES": "SQ",
  "TURKISH AIRLINES": "TK",
  "THAI AIRWAYS": "TG",
  ETHIOPIAN: "ET",
  COPA: "CM",
  BRUSSELS: "SN",
  TAP: "TP",
  ITA: "AZ",
  "AIR FRANCE": "AF",
  KLM: "KL",
  DELTA: "DL",
  "KOREAN AIR": "KE",
  "CHINA EASTERN": "MU",
  "VIRGIN ATLANTIC": "VS",
  SAUDIA: "SV",
  KENYA: "KQ",
  SAS: "SK",
  SCANDINAVIAN: "SK",
  "BRITISH AIRWAYS": "BA",
  IBERIA: "IB",
  "AMERICAN AIRLINES": "AA",
  AMERICAN: "AA",
  QATAR: "QR",
  "CATHAY PACIFIC": "CX",
  "JAPAN AIRLINES": "JL",
  JAL: "JL",
  QANTAS: "QF",
  FINNAIR: "AY",
  "MALAYSIA AIRLINES": "MH",
  "ROYAL JORDANIAN": "RJ",
  "SRI LANKAN": "UL",
  SRILANKAN: "UL",
};

/**
 * Airline ↔ alliance mapping. Keys are matched case-insensitively against
 * the Flight.airline field (display name or IATA code). Derived — every
 * member's code, plus the display names above resolved through it.
 */
export const AIRLINE_ALLIANCES: Readonly<Record<string, AllianceId>> = Object.freeze({
  ...Object.fromEntries(
    ALLIANCE_IDS.flatMap((id) => ALLIANCE_MEMBERS[id].map((code) => [code, id] as const))
  ),
  ...Object.fromEntries(
    Object.entries(ALLIANCE_NAME_TO_IATA).flatMap(([name, code]) => {
      const alliance = allianceOfIata(code);
      return alliance ? [[name, alliance] as const] : [];
    })
  ),
});

/** Low-cost carriers (used by LOWCOST_CHAMPION). */
export const LOW_COST_CARRIERS: ReadonlySet<string> = new Set([
  "RYANAIR",
  "FR",
  "EASYJET",
  "U2",
  "WIZZ AIR",
  "W6",
  "WIZZ",
  "EUROWINGS",
  "EW",
  "VUELING",
  "VY",
  "TRANSAVIA",
  "HV",
  "TO",
  "NORWEGIAN",
  "DY",
  "SPIRIT",
  "NK",
  "SOUTHWEST",
  "WN",
  "JETBLUE",
  "B6",
  "FRONTIER",
  "F9",
  "AIR ASIA",
  "AK",
  "AIRASIA",
  "JETSTAR",
  "JQ",
  "GOL",
  "G3",
  "AZUL",
  "AD",
  "INDIGO",
  "6E",
]);

/** Distance band thresholds for the premium-trifecta achievement. */
export const SHORT_HAUL_MAX_KM = 3500;
export const LONG_HAUL_MIN_KM = 3500;
export const ULTRA_LONG_HAUL_MIN_KM = 10000;

/** Whether the aircraft string falls into a given substring bucket. */
export function matchesAircraftBucket(
  aircraft: string | null,
  substrings: readonly string[]
): boolean {
  if (!aircraft) return false;
  const normalized = aircraft.toUpperCase().replace(/[-\s]/g, "");
  return substrings.some((s) => normalized.includes(s.replace(/[-\s]/g, "")));
}

/** Normalize an airline free-text / code to the alliance map key style. */
export function airlineAllianceOf(airline: string | null): "star" | "skyteam" | "oneworld" | null {
  if (!airline) return null;
  const up = airline.toUpperCase().trim();
  return AIRLINE_ALLIANCES[up] ?? AIRLINE_ALLIANCES[up.replace(/AIRLINES?$/, "").trim()] ?? null;
}

/** Whether the airline is a low-cost carrier. */
export function isLowCostCarrier(airline: string | null): boolean {
  if (!airline) return false;
  const up = airline.toUpperCase().trim();
  if (LOW_COST_CARRIERS.has(up)) return true;
  // Match partial (e.g. "Ryanair UK" → "RYANAIR")
  for (const name of LOW_COST_CARRIERS) {
    if (name.length > 3 && up.includes(name)) return true;
  }
  return false;
}
