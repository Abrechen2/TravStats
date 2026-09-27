import { formatWallClockIn } from "../../shared/zonedWallClock";
import { MissingZoneError } from "../../lib/api/timeInput";
import type { Flight } from "../../types";
import { isValidZone } from "../../shared/time";

/** The three pure date helpers of FlightEditModal, moved out so the modal
 *  stays under the 800-line ratchet (`scripts/check-file-size.mjs`). They
 *  carry no state; the contracts below are the modal's, restated here so
 *  the file is readable on its own. */

export interface DateTimeParts {
  date: string;
  time: string;
}

/** Split a UTC instant into separate `YYYY-MM-DD` / `HH:MM` strings in the
 *  BROWSER's local timezone. Used only as the initial seed before the
 *  airport timezones resolve — see the modal's hydration effect, which
 *  re-derives both parts as airport-local from the SAME source instant. */
export function splitLocalDatetime(iso: string | null): DateTimeParts {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Split a UTC instant into separate `YYYY-MM-DD` / `HH:MM` strings in the
 *  given IANA timezone (the departure/arrival airport's zone). Both parts
 *  are derived from the same `Date` + `tz` pair and returned together so a
 *  caller can only ever apply them in a single state update — never as two
 *  independent ones, which is exactly the drift this split guards against. */
export function splitZonedDatetime(iso: string | null, tz: string): DateTimeParts {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  // Not `formatInTimeZone`: it is an hour off whenever the airport's reading
  // falls into the BROWSER's own DST gap (see `shared/zonedWallClock.ts`).
  const wall = formatWallClockIn(d, tz);
  if (wall === null) throw new RangeError(`Invalid time zone: ${tz}`);
  return { date: wall.slice(0, 10), time: wall.slice(11, 16) };
}

/** For a historical flight the date field holds a SHAPE string ("YYYY",
 *  "YYYY-MM" or "YYYY-MM-DD") — the same convention the create form uses,
 *  expanded by buildLocalString on submit. UNKNOWN semantics means the day
 *  was never real (year or year+month precision), so the stored day-01 is
 *  dropped from display; any other semantics keeps the full date, so a
 *  DATE_ONLY flight's known day survives an edit instead of being rewritten
 *  to 01 like the old year+month-only block did. */
export function historicalShapeFor(fullDate: string, semantics?: string): string {
  return semantics === "UNKNOWN" ? fullDate.slice(0, 7) : fullDate;
}

/** The eight date/time inputs of the edit modal, as strings. */
export interface EditTimeInputs {
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
  actualDepartureDate: string;
  actualDepartureTime: string;
  actualArrivalDate: string;
  actualArrivalTime: string;
}

const TIME_INPUT_KEYS: readonly (keyof EditTimeInputs)[] = [
  "departureDate",
  "departureTime",
  "arrivalDate",
  "arrivalTime",
  "actualDepartureDate",
  "actualDepartureTime",
  "actualArrivalDate",
  "actualArrivalTime",
];

/**
 * The zones the edit modal submits its times in — the airports' own, and only
 * once both resolved (ADR 0002, D2).
 *
 * Before hydration the inputs hold a browser-local seed, and the modal used to
 * send them with the browser's zone: the instant came out right, but the
 * flight would be written with the reader's zone as its departure zone, and
 * an airport that never resolves left that for good. Now:
 * - hydrated → the two airport zones;
 * - not hydrated and no time touched (the inputs still equal one of the
 *   `unchanged` renderings: the browser seed, or the airport-local reading
 *   from before a later lookup failed) → null: the modal sends no time at
 *   all, so the server keeps what it stored (an edit of the notes moves
 *   nothing);
 * - not hydrated and a time changed → `MissingZoneError`, shown as the
 *   TZ_UNRESOLVED sentence, instead of a guessed zone.
 */
export function editSubmitZones(
  zones: { hydrated: boolean; depTz: string; arrTz: string },
  current: EditTimeInputs,
  unchanged: readonly EditTimeInputs[]
): { dep: string; arr: string } | null {
  if (zones.hydrated) return { dep: zones.depTz, arr: zones.arrTz };
  const same = (base: EditTimeInputs) => TIME_INPUT_KEYS.every((key) => current[key] === base[key]);
  if (unchanged.some(same)) return null;
  throw new MissingZoneError(
    TIME_INPUT_KEYS.find((key) => current[key] !== unchanged[0]?.[key]) ?? "departureDate"
  );
}

type StoredTimes = Pick<
  Flight,
  | "status"
  | "departureTime"
  | "arrivalTime"
  | "actualDeparture"
  | "actualArrival"
  | "depTimeSemantics"
>;

/**
 * The eight inputs as the stored instants read in the two airport zones —
 * what the modal's hydration effect shows, and what `editSubmitZones` treats
 * as "not touched" once a later lookup failed. All eight in one object, so a
 * caller can only ever apply them together (never a half-converted pair).
 * Historical flights re-derive the SHAPE string against the airport-local
 * calendar date, which fixes the month-boundary shift of the browser seed.
 */
export function airportLocalInputs(
  flight: StoredTimes,
  depTz: string,
  arrTz: string
): EditTimeInputs {
  const isHistorical = flight.status === "historical";
  const dep = splitZonedDatetime(flight.departureTime, depTz);
  const arr = splitZonedDatetime(flight.arrivalTime, arrTz);
  // Actual departure is read at the departure airport, actual arrival at the
  // arrival airport — mirroring the scheduled pair (#200).
  const actualDep = splitZonedDatetime(flight.actualDeparture ?? null, depTz);
  const actualArr = splitZonedDatetime(flight.actualArrival ?? null, arrTz);
  const shape = historicalShapeFor(dep.date, flight.depTimeSemantics);
  return {
    departureDate: isHistorical ? shape : dep.date,
    departureTime: isHistorical ? "" : dep.time,
    arrivalDate: isHistorical ? shape : arr.date,
    arrivalTime: isHistorical ? "" : arr.time,
    actualDepartureDate: actualDep.date,
    actualDepartureTime: actualDep.time,
    actualArrivalDate: actualArr.date,
    actualArrivalTime: actualArr.time,
  };
}

/**
 * The zone a flight end was WRITTEN with, while the form still names that
 * airport (ADR 0002 D2). The server stores it and does not re-derive it; the
 * modal reads and resends the end's times in it, so an edit of the seat no
 * longer swaps the stored zone for whatever the catalogue says today. A new
 * or changed airport, or a flight written before the zone was stored, has
 * none: null, and the airport lookup answers.
 */
export function storedZoneAt(
  picked: { iata?: string | null; icao?: string | null } | null,
  iata: string | null | undefined,
  icao: string | null | undefined,
  zone: string | null | undefined
): string | null {
  if (!picked || !zone || !isValidZone(zone)) return null;
  const same = (a: string | null | undefined, b: string | null | undefined) =>
    Boolean(a) && Boolean(b) && a!.toUpperCase() === b!.toUpperCase();
  const pickedCode = picked.iata || picked.icao;
  if (!pickedCode) return null;
  return same(picked.iata, iata) || (!picked.iata && same(picked.icao, icao)) ? zone : null;
}
