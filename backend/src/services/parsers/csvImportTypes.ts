import type { PreviewRowInput } from "../importPreview";

export interface ParserError {
  rowIndex: number;
  field?: string;
  message: string;
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
