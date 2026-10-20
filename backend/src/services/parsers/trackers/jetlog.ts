/**
 * Jetlog CSV export (Settings → "Export to CSV").
 *
 * Layout from the source, pbogre/jetlog @ 4306c3e4:
 *   - server/routers/exporting.py writes `FlightModel.get_attributes()` minus
 *     `id`, `username` and `connection` as the header, Python's csv.writer,
 *     with "\n" inside a value written as the two characters `\n`.
 *   - server/models.py declares the attributes in this order: date, origin,
 *     destination, departure_time, arrival_time, arrival_date, seat,
 *     aircraft_side, ticket_class, purpose, duration, distance, airplane,
 *     airline, tail_number, flight_number, notes. Airports and the airline
 *     are written as their ICAO codes; times are HH:MM local; duration is in
 *     minutes; ticket_class is economy | economy+ | business | first |
 *     private; purpose is leisure | business | crew | other.
 * Cross-checked against AirTrail's importer (src/lib/import/jetlog.ts @
 * a3404664).
 */
import { parseCsv, parseCsvHeader } from "../csvParser";
import type { PreviewRowInput } from "../../importPreview";
import type { ParseResult, ParserError } from "../csvImportTypes";
import {
  airlineFromCode,
  airportCode,
  isRealDate,
  missingHeaders,
  normalizeTime,
  present,
  rowError,
} from "./shared";

export const JETLOG_REQUIRED = ["date", "origin", "destination"] as const;

// "private" (a private aircraft) has no TravStats cabin — left empty, not guessed.
const CLASS: Record<string, PreviewRowInput["seatClass"]> = {
  economy: "economy",
  "economy+": "premium_economy",
  business: "business",
  first: "first",
};

const PURPOSE: Record<string, PreviewRowInput["category"]> = {
  leisure: "vacation",
  business: "business",
  crew: "other",
  other: "other",
};

const MINUTE = 60;

type RowRead = { row: PreviewRowInput } | { error: ParserError };

function readTime(
  rec: Record<string, string>,
  column: string,
  idx: number
): { time?: string; error?: ParserError } {
  const raw = present(rec[column]);
  if (!raw) return {};
  const time = normalizeTime(raw);
  if (time) return { time };
  return {
    error: rowError(idx, "invalidTime", `Invalid ${column}: ${raw}`, { field: column, value: raw }),
  };
}

function readRow(rec: Record<string, string>, idx: number): RowRead {
  const date = (rec["date"] ?? "").trim();
  if (!isRealDate(date)) {
    return {
      error: rowError(idx, "invalidDate", `Invalid date: ${date}`, { field: "date", value: date }),
    };
  }
  const fromIata = airportCode(rec["origin"]);
  const toIata = airportCode(rec["destination"]);
  if (!fromIata || !toIata) {
    return { error: rowError(idx, "missingIata", "Missing airport code in origin/destination") };
  }
  const dep = readTime(rec, "departure_time", idx);
  if (dep.error) return { error: dep.error };
  const arr = readTime(rec, "arrival_time", idx);
  if (arr.error) return { error: arr.error };
  const arrivalDate = present(rec["arrival_date"]);
  if (arrivalDate && !isRealDate(arrivalDate)) {
    return {
      error: rowError(idx, "invalidDate", `Invalid arrival_date: ${arrivalDate}`, {
        field: "arrival_date",
        value: arrivalDate,
      }),
    };
  }
  const minutes = Number(present(rec["duration"]));
  const airline = airlineFromCode(present(rec["airline"]));
  return {
    row: {
      date,
      depTimeLocal: dep.time,
      arrTimeLocal: arr.time,
      arrDate: arr.time ? arrivalDate : undefined,
      durationSeconds: Number.isFinite(minutes) && minutes > 0 ? minutes * MINUTE : undefined,
      fromIata,
      toIata,
      flightNumber: present(rec["flight_number"]),
      airline: airline?.name,
      aircraft: present(rec["airplane"]),
      registration: present(rec["tail_number"]),
      seatClass: CLASS[(present(rec["ticket_class"]) ?? "").toLowerCase()],
      category: PURPOSE[(present(rec["purpose"]) ?? "").toLowerCase()],
      notes: present(rec["notes"])?.replace(/\\n/g, "\n"),
      source: "jetlog",
      sourceRowIndex: idx,
    },
  };
}

export function parseJetlog(raw: string): ParseResult {
  const headerErrors = missingHeaders(parseCsvHeader(raw), JETLOG_REQUIRED);
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
