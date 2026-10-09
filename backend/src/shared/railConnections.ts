/**
 * Single source of truth for "which rail CONNECTION is this ride on" and "which
 * station is this" (forgejo#261) — the rail tab's favourite connections, its
 * new connections per year, and the rail badges that count them all ask here.
 *
 * A STATION is its code when the ride carries one, else its name with case and
 * spacing folded — the identity the station ranking on the rail tab has used
 * since 2.7 (`services/rail/railStats.ts`), moved here so the ranking and the
 * connections cannot name one station two ways.
 *
 * A CONNECTION is the UNORDERED pair of two stations — the direction rule of
 * `shared/routePair.ts` for flights (forgejo#254): Köln–Basel and Basel–Köln
 * are one connection, because "I took that train nine times" means both ways.
 * A ride whose two ends are the same station is on no connection (a round
 * excursion has no "between").
 *
 * Backend only: the clients read the result.
 */

import { localDay } from "./time/instant";

export interface RailStationRef {
  code: string | null;
  name: string;
}

/** `code:8011068` or `name:köln hbf`; null when neither is recorded. */
export function railStationKey(station: RailStationRef): string | null {
  const code = station.code?.trim();
  if (code) return `code:${code}`;
  const name = station.name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return name ? `name:${name}` : null;
}

export interface RailConnectionRide {
  depStationCode: string | null;
  depStationName: string;
  arrStationCode: string | null;
  arrStationName: string;
}

/** The key of the connection a ride is on, either direction; null without two distinct ends. */
export function railConnectionKey(ride: RailConnectionRide): string | null {
  const dep = railStationKey({ code: ride.depStationCode, name: ride.depStationName });
  const arr = railStationKey({ code: ride.arrStationCode, name: ride.arrStationName });
  if (dep === null || arr === null || dep === arr) return null;
  return dep < arr ? `${dep}|${arr}` : `${arr}|${dep}`;
}

export interface DatedConnectionRide extends RailConnectionRide {
  id: string;
  departureTime: Date;
  depTimezone: string | null;
}

/**
 * The first ride on every connection, in travel order — what "a new
 * connection" means: the year a connection was FIRST recorded is the year its
 * first counted ride left, on the departure station's calendar (the rule
 * `railCounting.railYear` files every ride under). A connection travelled
 * again later is not new again.
 */
export function firstRidesPerConnection<T extends DatedConnectionRide>(
  rides: readonly T[]
): Map<string, T> {
  const ordered = [...rides].sort(
    (a, b) =>
      a.departureTime.getTime() - b.departureTime.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const first = new Map<string, T>();
  for (const ride of ordered) {
    const key = railConnectionKey(ride);
    if (key !== null && !first.has(key)) first.set(key, ride);
  }
  return first;
}

/** The year a ride left, on its departure station's calendar (zone-less = UTC, the rail abstention). */
export function departureYearOf(ride: { departureTime: Date; depTimezone: string | null }): number {
  return Number(localDay(ride.departureTime, ride.depTimezone ?? "UTC").slice(0, 4));
}

/** New connections per year: how many connections had their first ride in it. */
export function newConnectionsByYear(rides: readonly DatedConnectionRide[]): Map<number, number> {
  const byYear = new Map<number, number>();
  for (const ride of firstRidesPerConnection(rides).values()) {
    const year = departureYearOf(ride);
    byYear.set(year, (byYear.get(year) ?? 0) + 1);
  }
  return byYear;
}

export interface StationVisitRide {
  depStationCode: string | null;
  depStationName: string;
  arrStationCode: string | null;
  arrStationName: string;
  departureTime: Date;
  arrivalTime: Date | null;
  depTimezone: string | null;
  arrTimezone: string | null;
}

/**
 * Whole calendar years between two `YYYY-MM-DD` days: 2019-05-04 to
 * 2024-05-04 is five, to 2024-05-03 is four. Pure date arithmetic on the keys.
 */
export function wholeYearsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const years = ty - fy;
  return tm < fm || (tm === fm && td < fd) ? years - 1 : years;
}

/**
 * The longest return to a station: across every station, the most whole years
 * between two consecutive days the user was there (departing from it on its
 * departure day, arriving at it on its arrival day — each on the station's own
 * calendar). A ride with no arrival leaves its arrival station out: a visit
 * without a day is not one that can be measured. 0 when no station was
 * visited on two different days.
 */
export function longestStationReturnYears(rides: readonly StationVisitRide[]): number {
  const days = new Map<string, Set<string>>();
  const visit = (code: string | null, name: string, day: string): void => {
    const key = railStationKey({ code, name });
    if (key === null) return;
    const set = days.get(key) ?? new Set<string>();
    set.add(day);
    days.set(key, set);
  };
  for (const ride of rides) {
    visit(
      ride.depStationCode,
      ride.depStationName,
      localDay(ride.departureTime, ride.depTimezone ?? "UTC")
    );
    if (ride.arrivalTime) {
      visit(
        ride.arrStationCode,
        ride.arrStationName,
        localDay(ride.arrivalTime, ride.arrTimezone ?? "UTC")
      );
    }
  }
  let best = 0;
  for (const set of days.values()) {
    const sorted = [...set].sort();
    for (let i = 1; i < sorted.length; i += 1) {
      best = Math.max(best, wholeYearsBetween(sorted[i - 1], sorted[i]));
    }
  }
  return best;
}
