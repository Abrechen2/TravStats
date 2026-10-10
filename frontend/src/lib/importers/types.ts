// Mirrors backend/src/services/importPreview.ts:PreviewRowInput.
// Keep these two in sync; if they ever drift, importPreview will reject
// the frontend payload at the Zod boundary.
export type ImporterSource = "fr24" | "generic_csv";

export interface PreviewRowInput {
  date: string;
  depTimeLocal?: string;
  arrTimeLocal?: string;
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
  | "missingIata";

export interface ParserError {
  /** 0-based data row; -1 for a problem with the file itself (headers, mapping). */
  rowIndex: number;
  field?: string;
  message: string;
  code?: ParserErrorCode;
  /** The offending value, when there is one (a date, a header name). */
  value?: string;
}

export type ImporterParser = (raw: string) => ParseResult;
