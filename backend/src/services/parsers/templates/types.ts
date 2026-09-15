export interface AirlineTemplateSelectors {
  flightNumber?: string;
  pnr?: string;
  departureTime?: string;
  arrivalTime?: string;
  departureCode?: string;
  arrivalCode?: string;
  seat?: string;
  seatClass?: string;
  price?: string;
  currency?: string;
  taxes?: string;
  fees?: string;
  baggage?: string;
  frequentFlyer?: string;
  ticketNumber?: string;
  bookingClassLetter?: string;
  terminal?: string;
  gate?: string;
  coPassengers?: string;
}

export type SelectorKey = keyof AirlineTemplateSelectors;

const MONTH_MAP: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  Mai: "05",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Okt: "10",
  Oct: "10",
  Nov: "11",
  Dez: "12",
  Dec: "12",
  Januar: "01",
  January: "01",
  Februar: "02",
  February: "02",
  März: "03",
  March: "03",
  April: "04",
  Juni: "06",
  June: "06",
  Juli: "07",
  July: "07",
  August: "08",
  September: "09",
  Oktober: "10",
  October: "10",
  November: "11",
  Dezember: "12",
  December: "12",
};

/**
 * Convert "18 Sep 2025T07:25" or "18. Oktober 2023 12:45" to ISO "2025-09-18T07:25".
 * Falls back to the original string if parsing fails.
 */
function parseToIso(v: string): string {
  // Already ISO-ish
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v;
  // "18 Sep 2025T07:25" (joined by applyTextPatterns from two capture groups)
  const m1 = v.match(/^(\d{1,2})\.?\s+([A-Za-zä-ü]{3,9})\.?\s+(\d{4})T(\d{1,2}:\d{2})$/i);
  if (m1) {
    const mo = MONTH_MAP[m1[2]] ?? "01";
    return `${m1[3]}-${mo}-${m1[1].padStart(2, "0")}T${m1[4].padStart(5, "0")}`;
  }
  // "18 Sep 2025" date only
  const m2 = v.match(/^(\d{1,2})\.?\s+([A-Za-zä-ü]{3,9})\.?\s+(\d{4})$/i);
  if (m2) {
    const mo = MONTH_MAP[m2[2]] ?? "01";
    return `${m2[3]}-${mo}-${m2[1].padStart(2, "0")}T00:00`;
  }
  // "18. Dezember 2024 16:05" style
  const m3 = v.match(/^(\d{1,2})\.?\s+([A-Za-zä-ü]{3,9})\.?\s+(\d{4})\s+(\d{1,2}:\d{2})/i);
  if (m3) {
    const mo = MONTH_MAP[m3[2]] ?? "01";
    return `${m3[3]}-${mo}-${m3[1].padStart(2, "0")}T${m3[4].padStart(5, "0")}`;
  }
  // "23.05.2025T12:25" — the numeric German date Lufthansa's newer mails use
  // in "23.05.2025 - 12:25", joined by applyTextPatterns from two groups.
  const m4 = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:T(\d{1,2}:\d{2}))?$/);
  if (m4) {
    const time = m4[4] ? m4[4].padStart(5, "0") : "00:00";
    return `${m4[3]}-${m4[2].padStart(2, "0")}-${m4[1].padStart(2, "0")}T${time}`;
  }
  return v;
}

export type TransformName =
  | "trim"
  | "uppercase"
  | "lowercase"
  | "extractIata"
  | "extractFlightNumber"
  | "removeSpaces"
  | "stripNonAlpha"
  | "parseIso";

export const TRANSFORMS: Record<TransformName, (value: string) => string> = {
  trim: (v) => v.trim(),
  uppercase: (v) => v.toUpperCase(),
  lowercase: (v) => v.toLowerCase(),
  extractIata: (v) => v.match(/\b[A-Z]{3}\b/)?.[0] ?? v,
  extractFlightNumber: (v) => v.match(/[A-Z]{2,3}\d{1,4}/)?.[0] ?? v,
  removeSpaces: (v) => v.replace(/\s+/g, ""),
  stripNonAlpha: (v) => v.replace(/[^A-Za-z0-9]/g, ""),
  parseIso: parseToIso,
};

export interface AirlineTemplateTestCase {
  input: string;
  expected: Partial<Record<SelectorKey, string>>;
}

/**
 * Regex patterns for plain-text email parsing.
 * Each key maps to an array of regex strings (tried in order).
 * The first capture group is the extracted value.
 * Supports multi-line patterns (DOTALL not assumed — use [\s\S] for multiline).
 */
export type TextPatterns = Partial<Record<SelectorKey, string[]>>;

export interface AirlineTemplate {
  airline: string;
  iata: string;
  version: string;
  from: string[];
  subject: string[];
  selectors: AirlineTemplateSelectors;
  /** Optional regex patterns applied to plain text (fallback if HTML selectors fail). */
  textPatterns?: TextPatterns;
  /**
   * Multi-leg mails. Every match of `splitPattern` (multiline, case-insensitive)
   * starts a new leg block; the text before the first match is the header and
   * is prepended to every block, so a shared field (booking code, ticket
   * number) resolves in each leg. Without this a template answers ONE leg per
   * mail — measured 2026-09-05 on the owner's 19 Lufthansa "Buchungsdetails"
   * mails: four legs in each, one candidate out, sometimes with a phantom
   * airport from the footer.
   */
  segments?: {
    splitPattern: string;
    /**
     * Optional fence. Legs are looked for only after the first match of
     * `startAfter` and before the next match of `endBefore`; the text before
     * the fence stays the header. Lufthansa's newer mails repeat every leg's
     * date line in a "Reiseplan" further down — without the fence each leg
     * would be read twice, once without its number.
     */
    startAfter?: string;
    endBefore?: string;
  };
  transforms: Partial<Record<SelectorKey, TransformName>>;
  testCases: AirlineTemplateTestCase[];
}

export function isValidAirlineTemplate(obj: unknown): obj is AirlineTemplate {
  if (typeof obj !== "object" || obj === null) return false;
  const t = obj as Record<string, unknown>;
  return (
    typeof t.airline === "string" &&
    typeof t.iata === "string" &&
    typeof t.version === "string" &&
    Array.isArray(t.from) &&
    Array.isArray(t.subject) &&
    typeof t.selectors === "object" &&
    t.selectors !== null &&
    typeof t.transforms === "object" &&
    t.transforms !== null &&
    Array.isArray(t.testCases)
  );
}
