/**
 * AirTrail export (Settings → Export → JSON).
 *
 * Layout from the source, johanohly/AirTrail @ a3404664:
 *   - src/lib/server/utils/backup.ts `generateBackup` — `{ users, flights }`,
 *     each flight the stored row minus ids: `from`/`to` are full airport
 *     objects (`icao`, `iata` or null, `tz`, …), `departure`/`arrival` are
 *     UTC instants or null, `duration` is seconds, `airline` and `aircraft`
 *     are objects with `name`/`icao`(/`iata`), `passengers` carry
 *     `seatNumber`, `seatClass` and `flightReason`.
 *   - src/lib/db/types.ts — seatClass economy | economy+ | business | first |
 *     private; flightReason leisure | business | crew | other; datePrecision
 *     day | month | year.
 *   - src/lib/import/airtrail.ts — older exports name an airport `{ code }`
 *     only; read that too.
 * The YAML variant of the same export is not read; the UI asks for JSON.
 *
 * AirTrail stores instants, TravStats takes the wall clock at the airport —
 * so each instant is read back in the airport zone the export itself carries.
 */
import { z } from "zod";
import { toLocal } from "../../../shared/time/instant";
import type { PreviewRowInput } from "../../importPreview";
import type { ParseResult, ParserError } from "../csvImportTypes";
import logger from "../../../utils/logger";
import { airportCode, isRealDate, present } from "./shared";

const nullableString = z.string().nullable().optional();

const airportSchema = z
  .object({ iata: nullableString, icao: nullableString, code: nullableString, tz: nullableString })
  .passthrough();

const flightSchema = z
  .object({
    date: z.string(),
    datePrecision: z.enum(["day", "month", "year"]).optional(),
    from: airportSchema,
    to: airportSchema,
    departure: nullableString,
    arrival: nullableString,
    duration: z.number().nullable().optional(),
    airline: z.object({ name: nullableString }).passthrough().nullable().optional(),
    aircraft: z.object({ name: nullableString }).passthrough().nullable().optional(),
    aircraftReg: nullableString,
    flightNumber: nullableString,
    note: nullableString,
    passengers: z
      .array(
        z
          .object({
            userId: nullableString,
            seatNumber: nullableString,
            seatClass: nullableString,
            flightReason: nullableString,
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

/** What makes a JSON file an AirTrail export at all. */
export const airTrailFileSchema = z.object({ flights: z.array(z.unknown()) }).passthrough();

const CLASS: Record<string, PreviewRowInput["seatClass"]> = {
  economy: "economy",
  "economy+": "premium_economy",
  business: "business",
  first: "first",
};

const REASON: Record<string, PreviewRowInput["category"]> = {
  leisure: "vacation",
  business: "business",
  crew: "other",
  other: "other",
};

type Flight = z.infer<typeof flightSchema>;
type Airport = z.infer<typeof airportSchema>;

const codeOf = (a: Airport): string | undefined =>
  airportCode(present(a.iata) ?? present(a.icao) ?? present(a.code) ?? undefined);

/** The instant's wall clock at the airport, or nothing when the zone is unusable. */
function wallClock(instant: string | null | undefined, zone: string | null | undefined) {
  if (!instant || !zone) return undefined;
  try {
    const local = toLocal(instant, zone).local;
    return { date: local.slice(0, 10), time: local.slice(11, 19) };
  } catch (err) {
    // A zone or instant this runtime cannot read: keep the flight, drop the
    // clock. Losing an hour is recoverable by hand; losing the flight is not.
    logger.warn({
      operation: "airtrail_import_unreadable_instant",
      instant,
      zone,
      err: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

function readFlight(flight: Flight, index: number): PreviewRowInput | ParserError {
  const entry = index + 1;
  // AirTrail keeps flights known only to the month or year; TravStats has
  // the same notion, so they come over as historical entries of that precision.
  const precision =
    flight.datePrecision === "month" || flight.datePrecision === "year"
      ? flight.datePrecision
      : undefined;
  if (!isRealDate(flight.date)) {
    return {
      rowIndex: index,
      entry,
      code: "invalidDate",
      value: flight.date,
      message: "Invalid date",
    };
  }
  const fromIata = codeOf(flight.from);
  const toIata = codeOf(flight.to);
  if (!fromIata || !toIata) {
    return { rowIndex: index, entry, code: "missingIata", message: "Missing airport code" };
  }
  const dep = precision ? undefined : wallClock(flight.departure, flight.from.tz);
  const arr = precision ? undefined : wallClock(flight.arrival, flight.to.tz);
  // The export may hold several people's seats; the one with an account is the owner's.
  const passengers = flight.passengers ?? [];
  const seat = passengers.find((p) => present(p.userId)) ?? passengers[0];
  return {
    date: dep?.date ?? flight.date,
    ...(precision ? { datePrecision: precision } : {}),
    depTimeLocal: dep?.time,
    arrDate: arr?.date,
    arrTimeLocal: arr?.time,
    // The instants themselves: they alone say which 02:30 of an autumn night was meant.
    depInstant: dep ? present(flight.departure) : undefined,
    arrInstant: arr ? present(flight.arrival) : undefined,
    durationSeconds:
      !precision && flight.duration && flight.duration > 0 ? flight.duration : undefined,
    fromIata,
    toIata,
    flightNumber: present(flight.flightNumber),
    airline: present(flight.airline?.name),
    aircraft: present(flight.aircraft?.name),
    registration: present(flight.aircraftReg),
    seatNumber: present(seat?.seatNumber),
    seatClass: CLASS[present(seat?.seatClass) ?? ""],
    category: REASON[present(seat?.flightReason) ?? ""],
    notes: present(flight.note),
    source: "airtrail",
    sourceRowIndex: index,
  };
}

export function parseAirTrail(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return {
      rows: [],
      parserErrors: [
        {
          rowIndex: -1,
          code: "invalidJson",
          message: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
  const file = airTrailFileSchema.safeParse(json);
  if (!file.success) {
    return {
      rows: [],
      parserErrors: [
        { rowIndex: -1, code: "missingHeader", value: "flights", message: 'No "flights" list' },
      ],
    };
  }

  const rows: PreviewRowInput[] = [];
  const parserErrors: ParserError[] = [];
  file.data.flights.forEach((candidate, index) => {
    const parsed = flightSchema.safeParse(candidate);
    if (!parsed.success) {
      parserErrors.push({
        rowIndex: index,
        entry: index + 1,
        code: "malformedEntry",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      return;
    }
    const read = readFlight(parsed.data, index);
    if ("source" in read) rows.push(read);
    else parserErrors.push(read);
  });
  return { rows, parserErrors };
}
