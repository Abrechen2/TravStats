/**
 * OpenFlights CSV export (openflights.org → Settings → Export).
 *
 * Layout from the source, jpatokal/openflights @ 56a3cce4:
 *   - php/flights.php writes the header
 *     `Date,From,To,Flight_Number,Airline,Distance,Duration,Seat,Seat_Type,
 *      Class,Reason,Plane,Registration,Trip,Note,From_OID,To_OID,Airline_OID,
 *      Plane_OID` behind a UTF-8 BOM, CRLF rows, the Note always quoted;
 *     `From`/`To` are IATA, or ICAO when the airport has no IATA code.
 *   - help/csv.php (format revision 0.42) defines the values: Date as
 *     YYYY-MM-DD, MM/DD/YYYY, DD.MM.YYYY or YYYY, optionally followed by the
 *     departure time HH:MM[:SS]; Duration HH:MM; Class F/C/P/Y (B is the old
 *     spelling of C); Reason B/L/C/O; Distance in miles.
 * Cross-checked against AirTrail's importer (src/lib/import/openflights.ts @
 * a3404664), which reads the same columns.
 *
 * The export has no arrival time — the preview derives it from the duration.
 */
import { parseCsv, parseCsvHeader } from "../csvParser";
import type { PreviewRowInput } from "../../importPreview";
import type { ParseResult, ParserError } from "../csvImportTypes";
import {
  airportCode,
  isRealDate,
  missingHeaders,
  normalizeTime,
  present,
  rowError,
} from "./shared";

export const OPENFLIGHTS_REQUIRED = ["Date", "From", "To"] as const;

const CLASS: Record<string, PreviewRowInput["seatClass"]> = {
  F: "first",
  C: "business",
  B: "business",
  P: "premium_economy",
  Y: "economy",
};

// "L" is what the OpenFlights UI calls personal/leisure travel.
const REASON: Record<string, PreviewRowInput["category"]> = {
  B: "business",
  L: "vacation",
  C: "other",
  O: "other",
};

/** OpenFlights' placeholder when it knows no airline. */
const NO_AIRLINE = "Unknown";

const YEAR_ONLY = /^\d{4}$/;
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const US = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const EU = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const DURATION = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/;

function isoDay(year: string, month: string, day: string): string {
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function readDay(raw: string): string | undefined {
  let m = ISO.exec(raw);
  if (m) return isoDay(m[1], m[2], m[3]);
  m = US.exec(raw);
  if (m) return isoDay(m[3], m[1], m[2]);
  m = EU.exec(raw);
  if (m) return isoDay(m[3], m[2], m[1]);
  return undefined;
}

function durationSeconds(raw: string | undefined): number | undefined {
  const m = DURATION.exec(raw ?? "");
  if (!m) return undefined;
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? "0");
  return seconds > 0 ? seconds : undefined;
}

type RowRead = { row: PreviewRowInput } | { error: ParserError };

function readRow(rec: Record<string, string>, idx: number): RowRead {
  const rawDate = (rec["Date"] ?? "").trim();
  const [dayPart, timePart] = rawDate.split(/\s+/, 2);
  // A year alone is a real OpenFlights entry ("flew to JFK sometime in
  // 2019"): kept as a historical flight of year precision, never as 1 January.
  const yearOnly = YEAR_ONLY.test(dayPart ?? "");
  const date = yearOnly ? `${dayPart}-01-01` : readDay(dayPart ?? "");
  if (!date || !isRealDate(date)) {
    return {
      error: rowError(idx, "invalidDate", `Invalid Date: ${rawDate}`, {
        field: "Date",
        value: rawDate,
      }),
    };
  }
  const depTimeLocal = timePart && !yearOnly ? normalizeTime(timePart) : undefined;
  if (timePart && !yearOnly && !depTimeLocal) {
    return {
      error: rowError(idx, "invalidTime", `Invalid time: ${timePart}`, {
        field: "Date",
        value: timePart,
      }),
    };
  }
  const fromIata = airportCode(rec["From"]);
  const toIata = airportCode(rec["To"]);
  if (!fromIata || !toIata) {
    return { error: rowError(idx, "missingIata", "Missing airport code in From/To") };
  }
  const airline = present(rec["Airline"]);
  return {
    row: {
      date,
      ...(yearOnly ? { datePrecision: "year" as const } : {}),
      depTimeLocal,
      durationSeconds: durationSeconds(present(rec["Duration"])),
      fromIata,
      toIata,
      flightNumber: present(rec["Flight_Number"]),
      airline: airline === NO_AIRLINE ? undefined : airline,
      aircraft: present(rec["Plane"]),
      registration: present(rec["Registration"]),
      seatNumber: present(rec["Seat"]),
      seatClass: CLASS[(present(rec["Class"]) ?? "").toUpperCase()],
      category: REASON[(present(rec["Reason"]) ?? "").toUpperCase()],
      notes: present(rec["Note"]),
      source: "openflights",
      sourceRowIndex: idx,
    },
  };
}

export function parseOpenFlights(raw: string): ParseResult {
  const headerErrors = missingHeaders(parseCsvHeader(raw), OPENFLIGHTS_REQUIRED);
  if (headerErrors.length > 0) return { rows: [], parserErrors: headerErrors };

  const rows: PreviewRowInput[] = [];
  const parserErrors: ParserError[] = [];
  parseCsv(raw).forEach((rec, idx) => {
    const read = readRow(rec, idx);
    if ("row" in read) rows.push(read.row);
    else parserErrors.push(read.error);
  });
  return { rows, parserErrors };
}
