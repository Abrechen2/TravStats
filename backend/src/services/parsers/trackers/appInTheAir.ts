/**
 * App in the Air data export (Profile → Settings → Export data; the app mails
 * a `.txt`). The service shut down in 2024, so these files are archives — and
 * the format is not documented by its maker. The layout comes from three
 * open-source readers and the sample exports they ship:
 *   - igorshh/myfr24-converter @ 2362f679, converter.py — names the 17
 *     `;`-separated fields of a line under `flights:`: class, seat, pnr, etkt,
 *     what, fare_class, import_source, airline_iata, flight_number,
 *     plane_iata, from_iata, to_iata, dep_utc, arr_utc, dep_local, arr_local,
 *     booked; `None` means empty. Sample: data/app_in_the_air_data_sample.txt.
 *   - moshobo/appintheair-exporter @ f6077c88, resources/example_data.txt —
 *     a second sample with the same shape.
 *   - johanohly/AirTrail @ a3404664, src/lib/import/aita.ts — trips are
 *     headed `Ownership.MINE;…` or `Ownership.NOT_MINE;…` (a flight tracked
 *     for someone else), and a trip's flights sit between `flights:` and
 *     `hotels:`.
 * The two samples confirm which clock is which: BA189 LHR→EWR reads
 * 15:10/23:25 then 15:10/18:25 — UTC first, local second.
 */
import type { PreviewRowInput } from "../../importPreview";
import type { ParseResult, ParserError } from "../csvImportTypes";
import {
  airlineFromCode,
  airportCode,
  joinFlightNumber,
  present,
  splitLocalDateTime,
} from "./shared";

const FIELD_COUNT = 17;
const F = {
  cabin: 0,
  seat: 1,
  pnr: 2,
  airline: 7,
  number: 8,
  plane: 9,
  from: 10,
  to: 11,
  depUtc: 12,
  arrUtc: 13,
  depLocal: 14,
  arrLocal: 15,
} as const;

/** Recognises the file: a `trips:` section with at least one trip header. */
export const APP_IN_THE_AIR_SIGNATURE = /^trips:\s*$[\s\S]*^Ownership\.\w+;/m;

const OWNER_RE = /^Ownership\.(\w+);/;
const SECTION_RE = /^(hotels|rental cars|expenses|trips):\s*$/;

/** "BUSINESS (C)" → BUSINESS, "ECO LIGHT" → ECOLIGHT. */
function cabinOf(raw: string | undefined): PreviewRowInput["seatClass"] {
  const key = (raw ?? "")
    .replace(/\(.*\)/, "")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!key) return undefined;
  if (key.startsWith("FIRST")) return "first";
  if (key.startsWith("BUSINESS")) return "business";
  if (key.startsWith("PREMIUM") || key === "PLUS") return "premium_economy";
  if (key.startsWith("ECO")) return "economy";
  return undefined;
}

function secondsBetween(
  fromUtc: string | undefined,
  toUtc: string | undefined
): number | undefined {
  const a = Date.parse(`${fromUtc ?? ""}Z`);
  const b = Date.parse(`${toUtc ?? ""}Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return undefined;
  return Math.round((b - a) / 1000);
}

function readFlight(
  fields: string[],
  rowIndex: number,
  line: number
): PreviewRowInput | ParserError {
  const dep = splitLocalDateTime(fields[F.depLocal] ?? "");
  const fromIata = airportCode(present(fields[F.from]));
  const toIata = airportCode(present(fields[F.to]));
  if (!dep) {
    return {
      rowIndex,
      line,
      code: "invalidDate",
      value: fields[F.depLocal],
      message: `Invalid departure: ${fields[F.depLocal]}`,
    };
  }
  if (!fromIata || !toIata) {
    return { rowIndex, line, code: "missingIata", message: "Missing airport code" };
  }
  const arr = splitLocalDateTime(fields[F.arrLocal] ?? "");
  const airline = airlineFromCode(present(fields[F.airline]));
  return {
    date: dep.date,
    depTimeLocal: dep.time,
    arrDate: arr?.date,
    arrTimeLocal: arr?.time,
    durationSeconds: secondsBetween(fields[F.depUtc], fields[F.arrUtc]),
    fromIata,
    toIata,
    flightNumber: joinFlightNumber(airline?.designator, present(fields[F.number])),
    airline: airline?.name,
    aircraft: present(fields[F.plane]),
    seatNumber: present(fields[F.seat]),
    seatClass: cabinOf(present(fields[F.cabin])),
    bookingReference: present(fields[F.pnr]),
    source: "app_in_the_air",
    sourceRowIndex: rowIndex,
  };
}

export function parseAppInTheAir(raw: string): ParseResult {
  const rows: PreviewRowInput[] = [];
  const parserErrors: ParserError[] = [];
  let owner: string | null = null;
  let inFlights = false;
  let rowIndex = 0;

  raw.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1;
    const owned = OWNER_RE.exec(text);
    if (owned) {
      owner = owned[1];
      inFlights = false;
      return;
    }
    if (text.trim() === "flights:") {
      inFlights = owner !== null;
      return;
    }
    if (SECTION_RE.test(text.trim())) {
      inFlights = false;
      return;
    }
    if (!inFlights || text.trim() === "") return;

    const index = rowIndex++;
    const fields = text.split(";");
    if (fields.length !== FIELD_COUNT) {
      parserErrors.push({
        rowIndex: index,
        line,
        code: "malformedEntry",
        message: `Expected ${FIELD_COUNT} fields, found ${fields.length}`,
      });
      return;
    }
    if (owner !== "MINE") {
      // App in the Air tracked friends' flights too; those are not the user's travel.
      parserErrors.push({
        rowIndex: index,
        line,
        code: "notOwnFlight",
        message: "Flight belongs to someone else (Ownership.NOT_MINE)",
      });
      return;
    }
    const read = readFlight(fields, index, line);
    if ("source" in read) rows.push(read);
    else parserErrors.push(read);
  });

  return { rows, parserErrors };
}
