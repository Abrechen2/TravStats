import { AppError } from "../../middleware/errorHandler";
import type { BusStationInput, UpdateBusJourneyInput } from "../../schemas/bus";
import { deriveBusStatus } from "../../shared/statusDerivation";
import { rideEndsAt } from "../../shared/railClock";
import { zoneOf } from "../../shared/time/zoneOf";
import { assertArrivalNotBefore, resolveDistance, resolveEnd } from "../rides/rideEnds";

/**
 * The write rules of a bus ride (spec 2026-10-07-bus-domain-design §3, §4).
 *
 * Rail's rules, reached through the shared ride-end module
 * (`services/rides/rideEnds.ts`): the two ends carry rail's column names, so the
 * clock helpers in `shared/railClock.ts` read a bus row as-is. What
 * is bus's own here is the terminal (no catalogue id, an address) and the
 * refusal codes, which name the domain so the form can word them.
 */

/** The row as far as these rules read it. */
export interface BusJourneyState {
  depStationName: string;
  depAddress: string | null;
  depLat: number;
  depLon: number;
  depCountry: string | null;
  depTimezone: string | null;
  arrStationName: string;
  arrAddress: string | null;
  arrLat: number;
  arrLon: number;
  arrCountry: string | null;
  arrTimezone: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  depPrecision?: string | null;
  arrPrecision?: string | null;
  distanceKm: number | null;
  distanceSource: string | null;
  status: string;
  /** Set only to clear a stored delay when the ride loses its clock. */
  delayMinutes?: number | null;
}

type TerminalColumns<P extends "dep" | "arr"> = {
  [
    K in `${P}StationName` | `${P}Address` | `${P}Lat` | `${P}Lon` | `${P}Country` | `${P}Timezone`
  ]: K extends `${P}Lat` | `${P}Lon`
    ? number
    : K extends `${P}StationName`
      ? string
      : string | null;
};

/** A terminal's columns, with its zone looked up from where it is (coordinates only — no catalogue). */
export function terminalColumns<P extends "dep" | "arr">(
  prefix: P,
  station: BusStationInput
): TerminalColumns<P> {
  return {
    [`${prefix}StationName`]: station.name,
    [`${prefix}Address`]: station.address ?? null,
    [`${prefix}Lat`]: station.lat,
    [`${prefix}Lon`]: station.lon,
    [`${prefix}Country`]: station.country ?? null,
    [`${prefix}Timezone`]: zoneOf({ catalogueZone: null, lat: station.lat, lon: station.lon }),
  } as TerminalColumns<P>;
}

function pickTerminal<P extends "dep" | "arr">(
  row: BusJourneyState,
  prefix: P
): TerminalColumns<P> {
  const read = (suffix: string): unknown =>
    (row as unknown as Record<string, unknown>)[`${prefix}${suffix}`];
  return {
    [`${prefix}StationName`]: read("StationName"),
    [`${prefix}Address`]: read("Address") ?? null,
    [`${prefix}Lat`]: read("Lat"),
    [`${prefix}Lon`]: read("Lon"),
    [`${prefix}Country`]: read("Country"),
    [`${prefix}Timezone`]: read("Timezone"),
  } as TerminalColumns<P>;
}

/**
 * Merge an update (or a create, with `existing = null`) into the final row
 * state. The wall clock NOT in the payload is read back from the stored
 * instant in the stored zone, so moving a terminal keeps "09:00 on the ticket"
 * and moves the instant with the zone.
 */
export function mergeBusJourney(
  existing: BusJourneyState | null,
  input: UpdateBusJourneyInput,
  now: Date = new Date()
): BusJourneyState {
  const dep = input.departureStation
    ? terminalColumns("dep", input.departureStation)
    : existing && pickTerminal(existing, "dep");
  const arr = input.arrivalStation
    ? terminalColumns("arr", input.arrivalStation)
    : existing && pickTerminal(existing, "arr");
  if (!dep || !arr) throw new AppError("Both terminals are required", 400, "BUS_INVALID_INPUT");

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
  if (!departure)
    throw new AppError("departureLocal is required", 400, "BUS_INVALID_INPUT", "departureLocal");
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
    "BUS_ARRIVAL_BEFORE_DEPARTURE"
  );

  const departureTime = departure.time;
  const arrivalTime = arrival?.time ?? null;
  const clockless = departure.precision === "day" || arrival?.precision === "day";
  if (clockless && input.delayMinutes !== undefined && input.delayMinutes !== null) {
    throw new AppError("a delay needs the ride's times", 400, "BUS_INVALID_INPUT", "delayMinutes");
  }

  const { distanceKm, distanceSource } = resolveDistance(existing, input, { ...dep, ...arr });
  const depPrecision = departure.precision;
  const arrPrecision = arrival?.precision ?? null;
  const status = deriveBusStatus({
    departureTime,
    arrivalTime,
    current: input.status ?? existing?.status ?? "scheduled",
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
    ...(clockless && { delayMinutes: null }),
  };
}
