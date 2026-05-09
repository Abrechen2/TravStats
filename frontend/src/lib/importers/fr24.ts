import { parseCsv } from "../csvParser";
import type { ParseResult, ParserError, PreviewRowInput } from "./types";

const REQUIRED_HEADERS = [
  "Date",
  "Flight number",
  "From",
  "To",
  "Dep time",
  "Arr time",
  "Duration",
];

const FLIGHT_REASON_MAP: Record<string, PreviewRowInput["category"]> = {
  "1": "vacation",
  "2": "business",
  "3": "private",
  "4": "private",
};

const FLIGHT_CLASS_MAP: Record<string, PreviewRowInput["seatClass"]> = {
  "1": "economy",
  "2": "premium_economy",
  "3": "business",
  "4": "first",
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HMS_RE = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const IATA_RE = /\(([A-Z0-9]{3,4})\/[A-Z0-9]{3,4}\)/;

function durationToSeconds(hms: string | undefined): number | undefined {
  if (!hms || !HMS_RE.test(hms)) return undefined;
  const [hh, mm, ss] = hms.split(":").map(Number);
  return hh * 3600 + mm * 60 + ss;
}

function isRealDate(d: string): boolean {
  if (!ISO_DATE_RE.test(d)) return false;
  const t = Date.parse(d + "T00:00:00Z");
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

export function parseFr24(raw: string): ParseResult {
  const errors: ParserError[] = [];
  const records = parseCsv(raw);
  const headers = records.length === 0 ? [] : Object.keys(records[0]);

  for (const h of REQUIRED_HEADERS) {
    if (!headers.includes(h)) {
      errors.push({ rowIndex: -1, message: `Missing required header column: ${h}` });
    }
  }
  if (errors.length > 0) return { rows: [], parserErrors: errors };

  const rows: PreviewRowInput[] = [];
  records.forEach((rec, idx) => {
    const date = rec["Date"];
    if (!isRealDate(date)) {
      errors.push({ rowIndex: idx, field: "Date", message: `Invalid Date: ${date}` });
      return;
    }
    const dep = rec["Dep time"];
    const arr = rec["Arr time"];
    if (dep && !HMS_RE.test(dep)) {
      errors.push({ rowIndex: idx, field: "Dep time", message: `Invalid Dep time: ${dep}` });
      return;
    }
    if (arr && !HMS_RE.test(arr)) {
      errors.push({ rowIndex: idx, field: "Arr time", message: `Invalid Arr time: ${arr}` });
      return;
    }
    const fromMatch = rec["From"]?.match(IATA_RE);
    const toMatch = rec["To"]?.match(IATA_RE);
    if (!fromMatch || !toMatch) {
      errors.push({ rowIndex: idx, field: "From/To", message: "Missing IATA in From/To" });
      return;
    }
    rows.push({
      date,
      depTimeLocal: dep || undefined,
      arrTimeLocal: arr || undefined,
      durationSeconds: durationToSeconds(rec["Duration"]),
      fromIata: fromMatch[1],
      toIata: toMatch[1],
      flightNumber: rec["Flight number"] || undefined,
      airline: rec["Airline"] || undefined,
      aircraft: rec["Aircraft"] || undefined,
      registration: rec["Registration"] || undefined,
      seatNumber: rec["Seat number"] || undefined,
      seatClass: FLIGHT_CLASS_MAP[rec["Flight class"]],
      category: FLIGHT_REASON_MAP[rec["Flight reason"]],
      notes: rec["Note"] || undefined,
      source: "fr24",
      sourceRowIndex: idx,
    });
  });

  return { rows, parserErrors: errors };
}
