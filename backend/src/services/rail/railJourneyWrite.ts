import { AppError } from "../../middleware/errorHandler";
import {
  type RailStationInput,
  type RailTracedDistanceSource,
  type UpdateRailJourneyInput,
} from "../../schemas/rail";
import { deriveRailStatus } from "../../shared/statusDerivation";
import { rideEndsAt } from "../../shared/railClock";
import { zoneOf } from "../../shared/time/zoneOf";
import {
  assertArrivalNotBefore,
  greatCircleKm,
  instantToWallClock,
  resolveDistance,
  resolveEnd,
  sentWallClockToInstant,
  wallClockToInstant,
} from "../rides/rideEnds";

// The clock primitives moved to `services/rides/rideEnds.ts` (shared with bus);
// rail's other modules and tests keep importing them from here.
export { greatCircleKm, instantToWallClock, sentWallClockToInstant, wallClockToInstant };

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
  /** Set only to clear a stored delay when the ride loses its clock. */
  delayMinutes?: number | null;
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

  const departure = resolveEnd({
    sent: input.departureLocal,
    fold: input.departureFold,
    zone: dep.depTimezone,
    stopMoved: Boolean(input.departureStation),
    stored: existing && {
      time: existing.departureTime,
      zone: existing.depTimezone,
      precision: existing.depPrecision ?? null,
    },
    field: "departureLocal",
  });
  if (!departure) throw new AppError("departureLocal is required", 400);
  const arrival = resolveEnd({
    sent: input.arrivalLocal,
    fold: input.arrivalFold,
    zone: arr.arrTimezone,
    stopMoved: Boolean(input.arrivalStation),
    stored:
      existing?.arrivalTime != null
        ? {
            time: existing.arrivalTime,
            zone: existing.arrTimezone,
            precision: existing.arrPrecision ?? null,
          }
        : null,
    field: "arrivalLocal",
  });
  assertArrivalNotBefore(
    departure,
    dep.depTimezone,
    arrival,
    arr.arrTimezone,
    "RAIL_ARRIVAL_BEFORE_DEPARTURE"
  );
  const departureTime = departure.time;
  const arrivalTime = arrival?.time ?? null;
  const clockless = departure.precision === "day" || arrival?.precision === "day";
  if (clockless && input.delayMinutes !== undefined && input.delayMinutes !== null) {
    // A delay is a difference between two clocks; a ride with none has none.
    throw new AppError("a delay needs the ride's times", 400, "RAIL_INVALID_INPUT", "delayMinutes");
  }

  const { distanceKm, distanceSource } = resolveDistance(existing, input, { ...dep, ...arr });

  const requested = input.status ?? existing?.status ?? "scheduled";
  const depPrecision = departure.precision;
  const arrPrecision = arrival?.precision ?? null;
  const status = deriveRailStatus({
    departureTime,
    arrivalTime,
    current: requested,
    now,
    endsAt: rideEndsAt({
      departureTime,
      arrivalTime,
      depTimezone: dep.depTimezone,
      arrTimezone: arr.arrTimezone,
      depPrecision,
      arrPrecision,
    }),
  });

  return {
    ...dep,
    ...arr,
    departureTime,
    arrivalTime,
    depPrecision,
    arrPrecision,
    distanceKm,
    distanceSource,
    status,
    // A clockless ride carries no delay; a stored one is cleared with the clock.
    ...(clockless && { delayMinutes: null }),
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
