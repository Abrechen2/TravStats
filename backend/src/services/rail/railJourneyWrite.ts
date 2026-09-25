import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { AppError } from "../../middleware/errorHandler";
import type { RailStationInput, UpdateRailJourneyInput } from "../../schemas/rail";
import { deriveRailStatus } from "../../shared/statusDerivation";
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
  depLat: number;
  depLon: number;
  depCountry: string | null;
  depTimezone: string | null;
  arrStationName: string;
  arrStationCode: string | null;
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
      `${P}StationName` | `${P}StationCode` | `${P}Lat` | `${P}Lon` | `${P}Country` | `${P}Timezone`
  ]: K extends `${P}Lat` | `${P}Lon`
    ? number
    : K extends `${P}StationName`
      ? string
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

  const departureTime = wallClockToInstant(departureWall, dep.depTimezone);
  const arrivalTime = arrivalWall ? wallClockToInstant(arrivalWall, arr.arrTimezone) : null;
  if (arrivalTime && arrivalTime.getTime() < departureTime.getTime()) {
    throw new AppError("arrival must not precede departure", 400);
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
