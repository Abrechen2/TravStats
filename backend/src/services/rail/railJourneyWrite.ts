import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { AppError } from "../../middleware/errorHandler";
import type { RailStationInput, UpdateRailJourneyInput } from "../../schemas/rail";
import { deriveRailStatus } from "../../shared/statusDerivation";
import { wallClockExists } from "../../shared/wallClockExistence";
import { calculateDistance } from "../../utils/geo";
import { timezoneOfLodging } from "../../utils/stayInstant";

/**
 * The write rules of a rail journey, in one place for create and update
 * (spec docs/superpowers/specs/2026-09-25-rail-domain.md).
 *
 * Three things are derived here and never taken from the client: the station
 * zones (from coordinates), the UTC instants (the station's wall clock in that
 * zone) and — unless the user typed one — the distance.
 */

/** The row as far as these rules read it. */
export interface RailJourneyState {
  depStationName: string;
  depStationCode: string | null;
  depStationId: number | null;
  depLat: number;
  depLon: number;
  depCountry: string | null;
  depTimezone: string | null;
  arrStationName: string;
  arrStationCode: string | null;
  arrStationId: number | null;
  arrLat: number;
  arrLon: number;
  arrCountry: string | null;
  arrTimezone: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  distanceKm: number | null;
  distanceSource: string | null;
  status: string;
}

type StationColumns<P extends "dep" | "arr"> = {
  [
    K in
      | `${P}StationName`
      | `${P}StationCode`
      | `${P}StationId`
      | `${P}Lat`
      | `${P}Lon`
      | `${P}Country`
      | `${P}Timezone`
  ]: K extends `${P}Lat` | `${P}Lon`
    ? number
    : K extends `${P}StationName`
      ? string
      : K extends `${P}StationId`
        ? number | null
        : string | null;
};

/**
 * A station's columns, with its zone looked up from where it is. Rounded to
 * whole kilometres is NOT done here — the distance keeps its precision and the
 * UI rounds for display.
 */
export function stationColumns<P extends "dep" | "arr">(
  prefix: P,
  station: RailStationInput
): StationColumns<P> {
  return {
    [`${prefix}StationName`]: station.name,
    [`${prefix}StationCode`]: station.code ?? null,
    [`${prefix}StationId`]: station.stationId ?? null,
    [`${prefix}Lat`]: station.lat,
    [`${prefix}Lon`]: station.lon,
    [`${prefix}Country`]: station.country ?? null,
    [`${prefix}Timezone`]: timezoneOfLodging(station.lat, station.lon),
  } as StationColumns<P>;
}

/**
 * The instant a station's wall clock names. A station in no zone (none exists
 * on land, but the lookup can abstain) keeps the wall clock as UTC — the same
 * fallback a stay without coordinates gets, and the zone column stays null so
 * nothing downstream pretends to know better.
 */
export function wallClockToInstant(wall: string, timezone: string | null): Date {
  const normalised = wall.length === 16 ? `${wall}:00` : wall;
  return timezone ? fromZonedTime(normalised, timezone) : new Date(`${normalised}Z`);
}

/**
 * A wall clock the USER sent, as an instant — refused when that clock never
 * showed it. On a spring-forward day one hour does not exist (02:30 on
 * 29 March 2026 in Europe/Berlin); `fromZonedTime` answers anyway, with an
 * instant an hour off, which read back as 01:30 and could even turn a valid
 * ride into "arrival before departure". Same rule and same check
 * (`shared/wallClockExistence.ts`) the flight schema applies; the repeated
 * autumn hour is a real time and passes.
 *
 * TODO(merge fix/night-small-2026-09-25): that branch reads wall clocks back
 * through `shared/zonedWallClock.ts`; `instantToWallClock` below should use it
 * when the branch lands.
 */
function sentWallClockToInstant(
  wall: string,
  timezone: string | null,
  field: "departureLocal" | "arrivalLocal"
): Date {
  if (timezone && !wallClockExists(wall.length === 16 ? `${wall}:00` : wall, timezone)) {
    throw new AppError(
      `${wall} does not exist in ${timezone} — the clocks skip that hour on this day`,
      400,
      "RAIL_LOCAL_TIME_NONEXISTENT",
      field
    );
  }
  return wallClockToInstant(wall, timezone);
}

/** The inverse: what the station clock read at `instant`. */
export function instantToWallClock(instant: Date, timezone: string | null): string {
  return formatInTimeZone(instant, timezone ?? "UTC", "yyyy-MM-dd'T'HH:mm");
}

/** Great-circle kilometres, one decimal — enough for a statistic, honest about being straight. */
export function greatCircleKm(state: {
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
}): number {
  const km = calculateDistance(state.depLat, state.depLon, state.arrLat, state.arrLon);
  return Math.round(km * 10) / 10;
}

/**
 * Merge an update (or a create, with `existing = null`) into the final row
 * state. The wall clock that is NOT in the payload is read back from the stored
 * instant in the stored zone, so moving a station keeps "08:15 on the ticket"
 * and moves the instant with the zone — the ticket, not the UTC value, is what
 * the user entered.
 */
export function mergeRailJourney(
  existing: RailJourneyState | null,
  input: UpdateRailJourneyInput,
  now: Date = new Date()
): RailJourneyState {
  const dep = input.departureStation
    ? stationColumns("dep", input.departureStation)
    : existing && pickStation(existing, "dep");
  const arr = input.arrivalStation
    ? stationColumns("arr", input.arrivalStation)
    : existing && pickStation(existing, "arr");
  if (!dep || !arr) throw new AppError("Both stations are required", 400);

  const departureWall =
    input.departureLocal ??
    (existing ? instantToWallClock(existing.departureTime, existing.depTimezone) : undefined);
  if (!departureWall) throw new AppError("departureLocal is required", 400);
  const arrivalWall =
    input.arrivalLocal !== undefined
      ? input.arrivalLocal
      : existing?.arrivalTime
        ? instantToWallClock(existing.arrivalTime, existing.arrTimezone)
        : null;

  // A clock read back from the stored instant exists by construction; only a
  // clock the request sent can name a skipped hour.
  const departureTime = input.departureLocal
    ? sentWallClockToInstant(departureWall, dep.depTimezone, "departureLocal")
    : wallClockToInstant(departureWall, dep.depTimezone);
  const arrivalTime = !arrivalWall
    ? null
    : input.arrivalLocal
      ? sentWallClockToInstant(arrivalWall, arr.arrTimezone, "arrivalLocal")
      : wallClockToInstant(arrivalWall, arr.arrTimezone);
  if (arrivalTime && arrivalTime.getTime() < departureTime.getTime()) {
    throw new AppError(
      "arrival must not precede departure",
      400,
      "RAIL_ARRIVAL_BEFORE_DEPARTURE",
      "arrivalLocal"
    );
  }

  const { distanceKm, distanceSource } = resolveDistance(existing, input, { ...dep, ...arr });

  const requested = input.status ?? existing?.status ?? "scheduled";
  const status = deriveRailStatus({ departureTime, arrivalTime, current: requested, now });

  return { ...dep, ...arr, departureTime, arrivalTime, distanceKm, distanceSource, status };
}

function pickStation<P extends "dep" | "arr">(row: RailJourneyState, prefix: P): StationColumns<P> {
  const read = (suffix: string): unknown =>
    (row as unknown as Record<string, unknown>)[`${prefix}${suffix}`];
  return {
    [`${prefix}StationName`]: read("StationName"),
    [`${prefix}StationCode`]: read("StationCode"),
    [`${prefix}StationId`]: read("StationId") ?? null,
    [`${prefix}Lat`]: read("Lat"),
    [`${prefix}Lon`]: read("Lon"),
    [`${prefix}Country`]: read("Country"),
    [`${prefix}Timezone`]: read("Timezone"),
  } as StationColumns<P>;
}

/**
 * A typed distance is kept until the user clears it; a measured one follows
 * the stations. Clearing (`null`) means "measure it again".
 */
function resolveDistance(
  existing: RailJourneyState | null,
  input: UpdateRailJourneyInput,
  coords: { depLat: number; depLon: number; arrLat: number; arrLon: number }
): { distanceKm: number; distanceSource: string } {
  if (typeof input.distanceKm === "number") {
    return { distanceKm: input.distanceKm, distanceSource: "user" };
  }
  if (
    input.distanceKm === undefined &&
    existing?.distanceSource === "user" &&
    existing.distanceKm
  ) {
    return { distanceKm: existing.distanceKm, distanceSource: "user" };
  }
  return { distanceKm: greatCircleKm(coords), distanceSource: "great_circle" };
}

/** A distance measured along a stored line rather than typed or straight. */
export function isTracedDistanceSource(source: string | null): boolean {
  return source === "route";
}

/**
 * The distance once the line is known. A typed distance always wins; a traced
 * line's own length beats the great-circle figure, which understates track by
 * 10–30 %; without a traced line the great-circle figure stands, labelled so.
 */
export function withTracedDistance(
  state: RailJourneyState,
  tracedKm: number | null
): RailJourneyState {
  if (state.distanceSource === "user" || tracedKm === null) return state;
  return { ...state, distanceKm: tracedKm, distanceSource: "route" };
}
