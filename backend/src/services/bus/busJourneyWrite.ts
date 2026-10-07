import { AppError } from "../../middleware/errorHandler";
import type { BusStationInput, UpdateBusJourneyInput } from "../../schemas/bus";
import { isLocalDayInput } from "../../schemas/wallClockInput";
import { deriveBusStatus } from "../../shared/statusDerivation";
import { TzUnresolvedError } from "../../shared/time/errors";
import { localDay, type Fold } from "../../shared/time/instant";
import { startOfDayAt } from "../../shared/time/legacyValues";
import { endHasClock, rideEndsAt } from "../../shared/railClock";
import { zoneOf } from "../../shared/time/zoneOf";
import {
  greatCircleKm,
  instantToWallClock,
  sentWallClockToInstant,
  wallClockToInstant,
} from "../rail/railJourneyWrite";

/**
 * The write rules of a bus ride (spec 2026-10-07-bus-domain-design §3, §4).
 *
 * Rail's rules, reached through rail's own functions: the two ends carry rail's
 * column names, so the clock helpers in `shared/railClock.ts` and the wall-clock
 * conversion in `services/rail/railJourneyWrite.ts` read a bus row as-is. What
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

interface EndReading {
  time: Date;
  precision: "minute" | "day";
}

/**
 * One end's instant and precision — rail's `resolveEnd` rule: a sent wall
 * clock is converted in the terminal's zone (a skipped hour refused), a bare
 * day becomes the start of that day there with precision `day`; a side not
 * sent keeps its stored instant unless its terminal moved, in which case the
 * ticket's wall clock is re-read in the new zone.
 */
function resolveEnd(args: {
  sent: string | null | undefined;
  fold: Fold | null | undefined;
  zone: string | null;
  terminalMoved: boolean;
  stored: { time: Date; zone: string | null; precision: string | null } | null;
  field: "departureLocal" | "arrivalLocal";
}): EndReading | null {
  const { sent, zone, stored, field } = args;
  if (sent === null) return null;
  if (sent !== undefined) {
    if (isLocalDayInput(sent)) {
      if (!zone) throw new TzUnresolvedError("the terminal has no zone", field);
      return { time: startOfDayAt(sent, zone), precision: "day" };
    }
    return { time: sentWallClockToInstant(sent, zone, field, args.fold), precision: "minute" };
  }
  if (!stored) return null;
  if (!endHasClock(stored.precision)) {
    if (!args.terminalMoved) return { time: stored.time, precision: "day" };
    const day = localDay(stored.time, stored.zone ?? "UTC");
    return { time: wallClockToInstant(`${day}T00:00`, zone), precision: "day" };
  }
  if (!args.terminalMoved) return { time: stored.time, precision: "minute" };
  return {
    time: wallClockToInstant(instantToWallClock(stored.time, stored.zone), zone),
    precision: "minute",
  };
}

function assertArrivalNotBefore(
  departure: EndReading,
  depZone: string | null,
  arrival: EndReading | null,
  arrZone: string | null
): void {
  if (!arrival) return;
  const bothClocked = departure.precision === "minute" && arrival.precision === "minute";
  const before = bothClocked
    ? arrival.time.getTime() < departure.time.getTime()
    : localDay(arrival.time, arrZone ?? "UTC") < localDay(departure.time, depZone ?? "UTC");
  if (before) {
    throw new AppError(
      "arrival must not precede departure",
      400,
      "BUS_ARRIVAL_BEFORE_DEPARTURE",
      "arrivalLocal"
    );
  }
}

/** A typed distance is kept until the user clears it; a measured one follows the terminals. */
function resolveDistance(
  existing: BusJourneyState | null,
  input: UpdateBusJourneyInput,
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
    terminalMoved: Boolean(input.departureStation),
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
    terminalMoved: Boolean(input.arrivalStation),
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
  assertArrivalNotBefore(departure, dep.depTimezone, arrival, arr.arrTimezone);

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
