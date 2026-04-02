// backend/src/services/parsers/userTemplates/types.ts

export interface TemplateFingerprint {
  senderDomains: string[];   // e.g. ["noti.swiss.com", "lufthansa.com"]
  subjectPatterns: string[]; // literal strings (case-insensitive match)
  bodyMarkers: string[];     // ALL must be present in body
}

export interface TemplatePatterns {
  pnr?: string;              // regex with one capture group
  flightNumber?: string;
  departureCode?: string;
  arrivalCode?: string;
  aircraftType?: string;
  // When true, use the structural Reiseplan segment parser for
  // flightNumber + departureTime + arrivalTime (multi-flight)
  useReiseplanSegments?: boolean;
  // Buchungsdetails IATA block regex (for IATA codes from details section)
  detailsBlock?: string;
}

export interface TemplateStats {
  matchCount: number;
  successRate: number; // 0-1
  lastUsedAt?: string; // ISO8601
}

export interface UserTemplate {
  id: string;
  userId: string;
  name: string;
  status: "pending" | "active" | "disabled";
  fingerprint: TemplateFingerprint;
  patterns: TemplatePatterns;
  stats?: TemplateStats;
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
}

// Per-field source used for colour-coding in FlightReviewModal.
// Keys match the property names on ParsedBooking (backend bookingParser.ts).
export type FieldSource = "template" | "llm" | "empty";
export type FieldSources = Partial<
  Record<
    | "flightNumber"
    | "departureCode"
    | "arrivalCode"
    | "departureTime"
    | "arrivalTime"
    | "pnr"
    | "aircraft"      // note: matches ParsedBooking.aircraft (not aircraftType)
    | "seat"
    | "terminal"
    | "gate",
    FieldSource
  >
>;

// Result of testing a template against existing training emails
export interface TemplateTestResult {
  emailId: string;
  emailSubject: string;
  expected: number;     // number of expected flights
  found: number;        // number of flights found by template
  fieldAccuracy: number; // 0-1 ratio of correctly extracted fields
}
