import { AppError } from "../../middleware/errorHandler";
import type {
  RailStationInput,
  RailTracedDistanceSource,
  UpdateRailJourneyInput,
} from "../../schemas/rail";
import { deriveRailStatus } from "../../shared/statusDerivation";
import { LocalTimeNonexistentError, TzUnresolvedError } from "../../shared/time/errors";
import { toInstant } from "../../shared/time/instant";
import { zoneOf } from "../../shared/time/zoneOf";
import { formatWallClockIn } from "../../shared/zonedWallClock";
import { calculateDistance } from "../../utils/geo";

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
  /** ADR 0002: minute when a wall clock was converted, null for no time. */
  depPrecision?: string | null;
  arrPrecision?: string | null;
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
  station: RailStationInput & { catalogueZone?: string | null }
): StationColumns<P> {
  return {
    [`${prefix}StationName`]: station.name,
    [`${prefix}StationCode`]: station.code ?? null,
    [`${prefix}StationId`]: station.stationId ?? null,
    [`${prefix}Lat`]: station.lat,
    [`${prefix}Lon`]: station.lon,
    [`${prefix}Country`]: station.country ?? null,
    // The station catalogue's zone first, its coordinates second (ADR 0002 D2).
    [`${prefix}Timezone`]: zoneOf({
      catalogueZone: station.catalogueZone,
      lat: station.lat,
      lon: station.lon,
    }),
  } as StationColumns<P>;
}

/**
 * The instant a station's wall clock names, read back from a STORED row or a
 * seed: a machine reading through `shared/time` (a skipped hour is not
 * refused). A stored row without a zone was written as UTC and is read back
 * as UTC — the one place this fallback survives, because it only restores
 * what that row already holds. A clock a request SENDS goes through
 * `sentWallClockToInstant`, which never falls back.
 */
export function wallClockToInstant(wall: string, timezone: string | null): Date {
  const normalised = wall.length === 16 ? `${wall}:00` : wall;
  return timezone
    ? toInstant(normalised, timezone, { origin: "machine" }).utc
    : new Date(`${normalised}Z`);
}

/**
 * A wall clock the USER sent, as an instant — refused when that clock never
 * showed it. On a spring-forward day one hour does not exist (02:30 on
 * 29 March 2026 in Europe/Berlin); `fromZonedTime` answers anyway, with an
 * instant an hour off, which read back as 01:30 and could even turn a valid
 * ride into "arrival before departure". Same rule and same check
 * (`shared/wallClockExistence.ts`) the flight schema applies; the repeated
 * autumn hour is a real time and passes.
 */
function sentWallClockToInstant(
  wall: string,
  timezone: string | null,
  field: "departureLocal" | "arrivalLocal"
): Date {
  // A station the resolver cannot place in a zone has no clock to read the
  // time on; it used to be read as UTC in silence (ADR 0002 D2).
  if (!timezone) throw new TzUnresolvedError("the station has no zone", field);
  try {
    return toInstant(wall, timezone, { origin: "typed" }).utc;
  } catch (error) {
    if (!(error instanceof LocalTimeNonexistentError)) throw error;
    // Rail keeps the code its form already maps (400, RAIL_…); the general
    // LOCAL_TIME_NONEXISTENT is the same statement for every other domain.
    throw new AppError(
      `${wall} does not exist in ${timezone} — the clocks skip that hour on this day`,
      400,
      "RAIL_LOCAL_TIME_NONEXISTENT",
      field
    );
  }
}

/**
 * The inverse: what the station clock read at `instant`, as `YYYY-MM-DDTHH:mm`.
 * Read through `shared/zonedWallClock.ts` — the one home for "instant to wall
 * clock", because `formatInTimeZone` slid a reading inside the HOST's own
 * spring-forward gap by an hour. A zone the runtime rejects reads as UTC, the
 * same fallback a station without a zone gets.
 */
export function instantToWallClock(instant: Date, timezone: string | null): string {
  const wall = formatWallClockIn(instant, timezone ?? "UTC") ?? formatWallClockIn(instant, "UTC");
  if (!wall) throw new RangeError("instantToWallClock: invalid instant");
  return wall.slice(0, 16);
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

  return {
    ...dep,
    ...arr,
    departureTime,
    arrivalTime,
    depPrecision: "minute",
    arrPrecision: arrivalTime ? "minute" : null,
    distanceKm,
    distanceSource,
    status,
  };
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
  return source === "route" || source === "roadtrip";
}

/**
 * What a line's length is called, by where the line came from: a converted
 * roadtrip leg's line (`manual`) is the roadtrip's, not Transitous' — the
 * list, detail page and statistics used to credit Transitous with it.
 */
export function tracedDistanceSourceFor(geometrySource: string): RailTracedDistanceSource {
  return geometrySource === "manual" ? "roadtrip" : "route";
}

/**
 * The distance once the line is known. A typed distance always wins; a traced
 * line's own length beats the great-circle figure, which understates track by
 * 10–30 %; without a traced line the great-circle figure stands, labelled so.
 */
export function withTracedDistance(
  state: RailJourneyState,
  tracedKm: number | null,
  source: RailTracedDistanceSource = "route"
): RailJourneyState {
  if (state.distanceSource === "user" || tracedKm === null) return state;
  return { ...state, distanceKm: tracedKm, distanceSource: source };
}
