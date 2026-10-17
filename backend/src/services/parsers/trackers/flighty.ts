/**
 * Flighty CSV export (Settings → Export flights). Flighty is closed source, so
 * the layout comes from three independent open-source importers that agree
 * on it:
 *   - pbogre/jetlog @ 4306c3e4, server/routers/importing.py — checks the full
 *     header verbatim: Date, Airline, Flight, From, To, Dep Terminal, Dep Gate,
 *     Arr Terminal, Arr Gate, Canceled, Diverted To, Gate Departure
 *     (Scheduled), Gate Departure (Actual), Take off (Scheduled), Take off
 *     (Actual), Landing (Scheduled), Landing (Actual), Gate Arrival
 *     (Scheduled), Gate Arrival (Actual), Aircraft Type Name, Tail Number,
 *     PNR, Seat, Seat Type, Cabin Class, Flight Reason, Notes, and five
 *     "… Flighty ID" columns; Cabin Class as ECONOMY / PREMIUM_ECONOMY /
 *     BUSINESS / FIRST / PRIVATE.
 *   - timelinize/timelinize @ 11ecc5af, datasources/flighty/csvfields.go.
 *   - johanohly/AirTrail @ a3404664, src/lib/import/flighty.ts — times are the
 *     airport's local wall clock (`YYYY-MM-DDTHH:MM`), Airline is the ICAO
 *     code, Flight the bare number.
 */
import { parseCsv, parseCsvHeader } from "../csvParser";
import type { PreviewRowInput } from "../../importPreview";
import type { ParseResult, ParserError } from "../csvImportTypes";
import {
  airlineFromCode,
  airportCode,
  isRealDate,
  joinFlightNumber,
  missingHeaders,
  present,
  rowError,
  splitLocalDateTime,
} from "./shared";

export const FLIGHTY_REQUIRED = ["Date", "Airline", "Flight", "From", "To"] as const;

const CABIN: Record<string, PreviewRowInput["seatClass"]> = {
  ECONOMY: "economy",
  PREMIUM_ECONOMY: "premium_economy",
  BUSINESS: "business",
  FIRST: "first",
};

const REASON: Record<string, PreviewRowInput["category"]> = {
  LEISURE: "vacation",
  PERSONAL: "vacation",
  BUSINESS: "business",
  CREW: "other",
  OTHER: "other",
};

/** Actual before scheduled: the log is of what happened. */
const DEPARTURE_COLUMNS = [
  "Gate Departure (Actual)",
  "Gate Departure (Scheduled)",
  "Take off (Actual)",
  "Take off (Scheduled)",
];
const ARRIVAL_COLUMNS = [
  "Gate Arrival (Actual)",
  "Gate Arrival (Scheduled)",
  "Landing (Actual)",
  "Landing (Scheduled)",
];

function firstReading(
  rec: Record<string, string>,
  columns: string[],
  idx: number
): { at?: { date: string; time: string }; error?: ParserError } {
  for (const column of columns) {
    const raw = present(rec[column]);
    if (!raw) continue;
    const at = splitLocalDateTime(raw);
    if (at) return { at };
    return {
      error: rowError(idx, "invalidTime", `Invalid ${column}: ${raw}`, {
        field: column,
        value: raw,
      }),
    };
  }
  return {};
}

const enumKey = (value: string | undefined): string =>
  (value ?? "").trim().toUpperCase().replace(/\s+/g, "_");

type RowRead = { row: PreviewRowInput } | { error: ParserError };

function readRow(rec: Record<string, string>, idx: number): RowRead {
  if ((present(rec["Canceled"]) ?? "").toLowerCase() === "true") {
    return { error: rowError(idx, "cancelled", "Flight was cancelled") };
  }
  const dep = firstReading(rec, DEPARTURE_COLUMNS, idx);
  if (dep.error) return { error: dep.error };
  const arr = firstReading(rec, ARRIVAL_COLUMNS, idx);
  if (arr.error) return { error: arr.error };
  const date = dep.at?.date ?? (rec["Date"] ?? "").trim();
  if (!isRealDate(date)) {
    return {
      error: rowError(idx, "invalidDate", `Invalid Date: ${date}`, { field: "Date", value: date }),
    };
  }
  const fromIata = airportCode(rec["From"]);
  const plannedTo = airportCode(rec["To"]);
  const divertedTo = airportCode(rec["Diverted To"]);
  // A diverted flight landed somewhere else; the logbook records where.
  const toIata = divertedTo ?? plannedTo;
  if (!fromIata || !toIata) {
    return { error: rowError(idx, "missingIata", "Missing airport code in From/To") };
  }
  const airline = airlineFromCode(present(rec["Airline"]));
  const notes = [
    present(rec["Notes"]),
    divertedTo && plannedTo ? `Diverted to ${divertedTo} (planned: ${plannedTo})` : undefined,
  ].filter((n): n is string => Boolean(n));
  return {
    row: {
      date,
      depTimeLocal: dep.at?.time,
      arrDate: arr.at?.date,
      arrTimeLocal: arr.at?.time,
      fromIata,
      toIata,
      flightNumber: joinFlightNumber(airline?.designator, present(rec["Flight"])),
      airline: airline?.name,
      aircraft: present(rec["Aircraft Type Name"]),
      registration: present(rec["Tail Number"]),
      seatNumber: present(rec["Seat"]),
      seatClass: CABIN[enumKey(rec["Cabin Class"])],
      category: REASON[enumKey(rec["Flight Reason"])],
      bookingReference: present(rec["PNR"]),
      notes: notes.length > 0 ? notes.join("\n") : undefined,
      source: "flighty",
      sourceRowIndex: idx,
    },
  };
}

export function parseFlighty(raw: string): ParseResult {
  const headerErrors = missingHeaders(parseCsvHeader(raw), FLIGHTY_REQUIRED);
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
