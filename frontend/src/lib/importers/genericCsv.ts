import { parseCsv } from "../csvParser";
import type { ParseResult, ParserError, PreviewRowInput } from "./types";

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

const REQUIRED_FIELDS: Array<keyof GenericMapping> = ["date", "fromIata", "toIata"];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HMS_RE = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

function isRealDate(d: string): boolean {
  if (!ISO_DATE_RE.test(d)) return false;
  const t = Date.parse(d + "T00:00:00Z");
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

export function parseGenericCsv(raw: string, mapping: GenericMapping): ParseResult {
  const errors: ParserError[] = [];

  for (const f of REQUIRED_FIELDS) {
    if (!mapping[f]) {
      errors.push({ rowIndex: -1, message: `Required field is unmapped: ${f}` });
    }
  }
  if (errors.length > 0) return { rows: [], parserErrors: errors };

  const records = parseCsv(raw);
  const headers = records.length === 0 ? [] : Object.keys(records[0]);

  for (const v of Object.values(mapping)) {
    if (v && !headers.includes(v)) {
      errors.push({ rowIndex: -1, message: `Mapped column not found in CSV: ${v}` });
    }
  }
  if (errors.length > 0) return { rows: [], parserErrors: errors };

  const rows: PreviewRowInput[] = [];
  records.forEach((rec, idx) => {
    const date = rec[mapping.date!];
    if (!isRealDate(date)) {
      errors.push({ rowIndex: idx, field: "date", message: `Invalid Date: ${date}` });
      return;
    }
    const dep = mapping.depTimeLocal ? rec[mapping.depTimeLocal] : undefined;
    const arr = mapping.arrTimeLocal ? rec[mapping.arrTimeLocal] : undefined;
    if (dep && !HMS_RE.test(dep)) {
      errors.push({ rowIndex: idx, field: "depTimeLocal", message: `Invalid time: ${dep}` });
      return;
    }
    if (arr && !HMS_RE.test(arr)) {
      errors.push({ rowIndex: idx, field: "arrTimeLocal", message: `Invalid time: ${arr}` });
      return;
    }
    rows.push({
      date,
      depTimeLocal: dep || undefined,
      arrTimeLocal: arr || undefined,
      fromIata: rec[mapping.fromIata!]?.toUpperCase() || "",
      toIata: rec[mapping.toIata!]?.toUpperCase() || "",
      flightNumber: mapping.flightNumber ? rec[mapping.flightNumber] : undefined,
      airline: mapping.airline ? rec[mapping.airline] : undefined,
      aircraft: mapping.aircraft ? rec[mapping.aircraft] : undefined,
      registration: mapping.registration ? rec[mapping.registration] : undefined,
      seatNumber: mapping.seatNumber ? rec[mapping.seatNumber] : undefined,
      notes: mapping.notes ? rec[mapping.notes] : undefined,
      source: "generic_csv",
      sourceRowIndex: idx,
    });
  });

  return { rows, parserErrors: errors };
}
