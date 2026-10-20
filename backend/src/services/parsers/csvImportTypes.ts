import type { PreviewRowInput } from "../importPreview";

/**
 * What went wrong, as a stable code the UI turns into DE/EN copy. `message`
 * stays for logs and API consumers; it is English and must never reach the
 * screen. Mirrored in `frontend/src/lib/importers/types.ts`.
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
  /** 0-based data row; -1 for a problem with the file itself (headers, format). */
  rowIndex: number;
  field?: string;
  message: string;
  code?: ParserErrorCode;
  /** The offending value, when there is one (a date, a header name). */
  value?: string;
  /**
   * 1-based line of the FILE, for a format whose rows are not "header + one
   * line per row" (App in the Air's text export). Absent for CSV, where the
   * UI derives the line from `rowIndex`.
   */
  line?: number;
  /** 1-based position in a JSON list (AirTrail), which has no lines to name. */
  entry?: number;
}

export interface ParseResult {
  rows: PreviewRowInput[];
  parserErrors: ParserError[];
}

export interface GenericMapping {
  date?: string;
  depTimeLocal?: string;
  arrTimeLocal?: string;
  fromIata?: string;
  toIata?: string;
  flightNumber?: string;
  airline?: string;
  aircraft?: string;
  registration?: string;
  seatNumber?: string;
  notes?: string;
}
