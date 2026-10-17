// Mirrors backend/src/services/importPreview.ts:PreviewRowInput.
// Keep these two in sync; if they ever drift, importPreview will reject
// the frontend payload at the Zod boundary.
/**
 * Other flight trackers whose exports the server reads (forgejo#311).
 * Mirrors `backend/src/services/parsers/trackers/formats.ts`.
 */
export const TRACKER_FORMATS = [
  "openflights",
  "airtrail",
  "jetlog",
  "flighty",
  "app_in_the_air",
] as const;
export type TrackerFormat = (typeof TRACKER_FORMATS)[number];

/** What the tracker entry point can recognise a file as — FR24 included. */
export type DetectableFormat = TrackerFormat | "fr24";

export type ImporterSource = "fr24" | "generic_csv" | TrackerFormat;

export interface PreviewRowInput {
  date: string;
  depTimeLocal?: string;
  arrTimeLocal?: string;
  /** The arrival's own day, when the source knows it. */
  arrDate?: string;
  durationSeconds?: number;
  fromIata: string;
  toIata: string;
  flightNumber?: string;
  airline?: string;
  aircraft?: string;
  registration?: string;
  seatNumber?: string;
  seatClass?: "economy" | "premium_economy" | "business" | "first";
  category?: "business" | "vacation" | "private" | "training" | "ferry" | "other";
  notes?: string;
  bookingReference?: string;
  /** Only the year or month is known; `date` is then the 1st of the period. */
  datePrecision?: "year" | "month";
  source: ImporterSource;
  sourceRowIndex: number;
}

export interface ParseResult {
  rows: PreviewRowInput[];
  parserErrors: ParserError[];
}

/**
 * What went wrong, as a stable code the UI turns into DE/EN copy. `message`
 * stays for logs and tests; it is English and must never reach the screen.
 */
export type ParserErrorCode =
  | "missingHeader"
  | "unmappedField"
  | "missingColumn"
  | "invalidDate"
  | "invalidTime"
  | "missingIata"
  // Tracker exports (forgejo#311)
  | "unknownFormat"
  | "invalidJson"
  | "cancelled"
  | "notOwnFlight"
  | "malformedEntry";

export interface ParserError {
  /** 0-based data row; -1 for a problem with the file itself (headers, mapping). */
  rowIndex: number;
  field?: string;
  message: string;
  code?: ParserErrorCode;
  /** The offending value, when there is one (a date, a header name). */
  value?: string;
  /** 1-based line of the file, for a format whose rows are not one line each after a header. */
  line?: number;
  /** 1-based position in a JSON list (AirTrail), which has no lines. */
  entry?: number;
}

export type ImporterParser = (raw: string) => ParseResult;
