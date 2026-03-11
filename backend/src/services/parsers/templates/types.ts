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
  transforms: Partial<Record<SelectorKey, string>>;
  testCases: AirlineTemplateTestCase[];
}

export function isValidAirlineTemplate(obj: unknown): obj is AirlineTemplate {
  if (typeof obj !== "object" || obj === null) return false;
  const t = obj as Record<string, unknown>;
  return (
    typeof t["airline"] === "string" &&
    typeof t["iata"] === "string" &&
    typeof t["version"] === "string" &&
    Array.isArray(t["from"]) &&
    Array.isArray(t["subject"]) &&
    typeof t["selectors"] === "object" &&
    t["selectors"] !== null
  );
}
