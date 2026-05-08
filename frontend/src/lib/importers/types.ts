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

export interface ParserError {
  rowIndex: number;
  field?: string;
  message: string;
}

export type ImporterParser = (raw: string) => ParseResult;
