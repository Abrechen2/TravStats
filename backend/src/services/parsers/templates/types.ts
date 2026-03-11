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

export type TransformName =
  | "trim"
  | "uppercase"
  | "lowercase"
  | "extractIata"
  | "extractFlightNumber"
  | "removeSpaces"
  | "stripNonAlpha";

export const TRANSFORMS: Record<TransformName, (value: string) => string> = {
  trim: (v) => v.trim(),
  uppercase: (v) => v.toUpperCase(),
  lowercase: (v) => v.toLowerCase(),
  extractIata: (v) => v.match(/\b[A-Z]{3}\b/)?.[0] ?? v,
  extractFlightNumber: (v) => v.match(/[A-Z]{2,3}\d{1,4}/)?.[0] ?? v,
  removeSpaces: (v) => v.replace(/\s+/g, ""),
  stripNonAlpha: (v) => v.replace(/[^A-Za-z0-9]/g, ""),
};

export interface AirlineTemplateTestCase {
  input: string;
  expected: Partial<Record<SelectorKey, string>>;
}

export interface AirlineTemplate {
  airline: string;
  iata: string;
  version: string;
  from: string[];
  subject: string[];
  selectors: AirlineTemplateSelectors;
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
