/**
 * What KIND of bus ride this was, and which terminal is which (forgejo#263) —
 * one home for the questions the bus statistics, the bus badges, the evidence
 * panel and the travel account ask.
 *
 * Which rides count at all is NOT decided here: that is `busCounting.ts`
 * (completed only). Every function below is asked only about counted rides.
 *
 * Backend only: the clients read the result.
 */

import { rideHasClocks } from "./railClock";
import { OVERNIGHT_MIN_HOURS } from "./railRideKinds";
import { SAME_STATION_KM } from "./railJourneyGrouping";
import { haversineKm } from "./geo/haversine";
import { localDay } from "./time/instant";

export interface BusNightFacts {
  departureTime: Date;
  arrivalTime: Date | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  depPrecision: string | null;
  arrPrecision: string | null;
}

const dayOf = (instant: Date, zone: string | null): string => localDay(instant, zone ?? "UTC");

/**
 * A night bus, by the night rule rail's overnight branch uses
 * (`railRideKinds.isNightTrainRide`, the issue's "same night rule as rail"):
 * it arrives on a LATER day of its arrival terminal's calendar than it left on
 * its departure terminal's, after at least `OVERNIGHT_MIN_HOURS` on board,
 * and both ends carry a clock. A coach has no sleeper class or night category,
 * so the clock is the only evidence — and a date-only ride has none: a missing
 * time is never invented into a night.
 */
export function isNightBusRide(ride: BusNightFacts): boolean {
  if (!ride.arrivalTime || !rideHasClocks(ride)) return false;
  const dep = dayOf(ride.departureTime, ride.depTimezone);
  const arr = dayOf(ride.arrivalTime, ride.arrTimezone);
  const hours = (ride.arrivalTime.getTime() - ride.departureTime.getTime()) / 3_600_000;
  return arr > dep && hours >= OVERNIGHT_MIN_HOURS;
}

/**
 * The nights slept on a night bus, as `YYYY-MM-DD` night-starting days on the
 * terminals' calendars — from the departure day (inclusive) to the arrival day
 * (exclusive), the shape `railRideKinds.nightTrainNights` hands the travel
 * account. `[]` for a ride that is not a night bus. A night bus always has
 * both ends and both clocks, so there is no undated case here.
 */
export function nightBusNights(ride: BusNightFacts): string[] {
  if (!isNightBusRide(ride)) return [];
  const from = Date.parse(`${dayOf(ride.departureTime, ride.depTimezone)}T00:00:00Z`);
  const to = Date.parse(`${dayOf(ride.arrivalTime as Date, ride.arrTimezone)}T00:00:00Z`);
  const nights: string[] = [];
  for (let cursor = from; cursor < to; cursor += 86_400_000) {
    nights.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return nights;
}

export interface TerminalRef {
  name: string;
  lat: number;
  lon: number;
}

/**
 * Two records within this distance that carry the same name are one terminal
 * even when the pins disagree — a geocoder pick and a hand-placed pin of the
 * same "ZOB" a few streets apart.
 */
export const SAME_NAME_TERMINAL_KM = 10;

const fold = (name: string): string => name.trim().replace(/\s+/g, " ").toLocaleLowerCase();

/**
 * One terminal or two? Within `SAME_STATION_KM` (rail's rule for one place to
 * change at) whatever the names say; with the same folded name within
 * `SAME_NAME_TERMINAL_KM`. NOT the same name alone, as rail's `sameStation`
 * allows inside one booking: across a whole logbook "ZOB" or "Central Bus
 * Station" names a terminal in every second city.
 */
export function sameTerminal(a: TerminalRef, b: TerminalRef): boolean {
  const km = haversineKm(a, b);
  if (km <= SAME_STATION_KM) return true;
  return fold(a.name) !== "" && fold(a.name) === fold(b.name) && km <= SAME_NAME_TERMINAL_KM;
}

/**
 * Terminals with a STABLE identity: a coach stop has no catalogue and no code,
 * and is often typed as an address, so identity is `sameTerminal`. Each record
 * joins the FIRST terminal it matches, read in the order given, so the same
 * rides always produce the same terminals.
 */
export class TerminalRegistry {
  private readonly terminals: TerminalRef[] = [];

  /** The terminal's index — stable for the life of the registry. */
  idOf(ref: TerminalRef): number {
    const found = this.terminals.findIndex((t) => sameTerminal(t, ref));
    if (found >= 0) return found;
    this.terminals.push(ref);
    return this.terminals.length - 1;
  }

  /** The first name a terminal was recorded under. */
  nameOf(id: number): string {
    return this.terminals[id].name.trim();
  }

  get size(): number {
    return this.terminals.length;
  }
}

export interface TerminalRide {
  id: string;
  depStationName: string;
  depLat: number;
  depLon: number;
  arrStationName: string;
  arrLat: number;
  arrLon: number;
  departureTime: Date;
}

/** Rides in travel order (departure, then id) — the order every terminal fold reads them in. */
export function inTravelOrder<T extends Pick<TerminalRide, "id" | "departureTime">>(
  rides: readonly T[]
): T[] {
  return [...rides].sort(
    (a, b) =>
      a.departureTime.getTime() - b.departureTime.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Each ride's two terminal ids, from one registry over the rides in travel order. */
export function terminalsOf<T extends TerminalRide>(
  rides: readonly T[]
): { registry: TerminalRegistry; ends: Map<string, { dep: number; arr: number }> } {
  const registry = new TerminalRegistry();
  const ends = new Map<string, { dep: number; arr: number }>();
  for (const ride of inTravelOrder(rides)) {
    ends.set(ride.id, {
      dep: registry.idOf({ name: ride.depStationName, lat: ride.depLat, lon: ride.depLon }),
      arr: registry.idOf({ name: ride.arrStationName, lat: ride.arrLat, lon: ride.arrLon }),
    });
  }
  return { registry, ends };
}

/** The connection a ride is on, both directions together; null when both ends are one terminal. */
export function busConnectionKey(ends: { dep: number; arr: number }): string | null {
  if (ends.dep === ends.arr) return null;
  return ends.dep < ends.arr ? `${ends.dep}|${ends.arr}` : `${ends.arr}|${ends.dep}`;
}

/** One moment at a terminal: the traveller arrived there, or left it. */
export interface TerminalEvent {
  kind: "arr" | "dep";
  /** The real instant — orders two events of one day. */
  at: Date;
  /** `YYYY-MM-DD` on the terminal's calendar — what a gap is measured in. */
  day: string;
  /** The ride this end belongs to, when the caller wants the return named (evidence). */
  rideId?: string;
}

/**
 * The most days between two SEPARATE visits of one terminal (review I3 of
 * forgejo#263/#265). A visit runs from an arrival to the next departure, so an
 * arrival and the ride out of the same stay are ONE visit, never a return.
 * A return is measured from the end of a visit to the start of the next:
 *   - a departure with no open visit is a visit on its own (the arrival was
 *     not recorded — the logbook's home terminal, typically);
 *   - an arrival while a visit is still open means the departure in between
 *     was not recorded: the earlier visit ended at its last known day.
 * Null when no terminal was visited twice. A one-way chain A → B → C returns
 * to nothing; leaving A and arriving back at A three weeks later does.
 */
export function longestReturnDays(events: readonly TerminalEvent[]): number | null {
  return longestReturn(events)?.days ?? null;
}

/** `longestReturnDays` with its witness: the event that started the return visit. */
export function longestReturn(
  events: readonly TerminalEvent[]
): { days: number; returning: TerminalEvent } | null {
  const ordered = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  let best: { days: number; returning: TerminalEvent } | null = null;
  let open = false;
  let lastDay: string | null = null;
  for (const event of ordered) {
    const startsVisit = event.kind === "arr" || !open;
    if (startsVisit && lastDay !== null) {
      const gap = Math.round((Date.parse(event.day) - Date.parse(lastDay)) / 86_400_000);
      if (gap > 0 && (best === null || gap > best.days)) best = { days: gap, returning: event };
    }
    open = event.kind === "arr";
    lastDay = event.day;
  }
  return best;
}
