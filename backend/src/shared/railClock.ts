/**
 * Does a train ride's stored time carry a CLOCK, or only a day?
 *
 * A ride may be logged date-only (forgejo#132 item 17, owner 2026-10-01): a
 * Flexpreis ticket binds no train, so "keine Uhrzeit auf dem Ticket" is the
 * truth, not a gap to fill. Such an end is stored as the START of its day on
 * the station's calendar with precision `day` (ADR 0002) — a real instant, so
 * the calendar day, the year and the sort order stay right, but NOT a clock:
 * midnight there means "some time that day".
 *
 * Every reader that measures between instants asks here first, and abstains
 * for a clockless ride exactly as for a date-only flight: no duration, no
 * delay, no overnight-by-the-clock night train, no countdown in hours. A
 * missing clock read as 00:00 would make a day ride 24 h long and a night
 * train. Readers of the DAY (year, calendar day, country) need nothing from
 * here: the stored instant already falls on the right day.
 *
 * Backend only. The web reads `precision` off each `TimeValue` directly.
 */

import { localDay } from "./time/instant";
import { startOfDayAt } from "./time/legacyValues";

/** Precisions that name a day but no time of day. */
export const CLOCKLESS_PRECISIONS = ["day", "unknown"] as const;

/**
 * Whether a stored end carries a clock. `null` is a row written before the
 * precision column existed, when every rail write converted a wall clock.
 */
export function endHasClock(precision: string | null | undefined): boolean {
  return !(CLOCKLESS_PRECISIONS as readonly (string | null | undefined)[]).includes(precision);
}

export interface RailClockFacts {
  departureTime: Date;
  arrivalTime: Date | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  depPrecision: string | null;
  arrPrecision: string | null;
}

/**
 * Both ends timed to the minute — the condition for a duration. A ride with no
 * arrival has no duration either, but that is the caller's own null check.
 */
export function rideHasClocks(
  ride: Pick<RailClockFacts, "depPrecision" | "arrPrecision">
): boolean {
  return endHasClock(ride.depPrecision) && endHasClock(ride.arrPrecision);
}

/**
 * Hours on board of ONE ride, or null when the ride cannot answer: both ends
 * must carry a clock, there must be an arrival, and it must not lie before the
 * departure. The rail and bus tabs sum this over their rides, and their
 * evidence panels list it ride by ride — one rule, so a ride the tile left
 * out is never listed and one it counted is never missing.
 */
export function rideHoursOnBoard(
  ride: Pick<RailClockFacts, "departureTime" | "arrivalTime" | "depPrecision" | "arrPrecision">
): number | null {
  if (ride.arrivalTime === null || !rideHasClocks(ride)) return null;
  const ms = ride.arrivalTime.getTime() - ride.departureTime.getTime();
  return ms < 0 ? null : ms / 3_600_000;
}

/**
 * The Prisma `where` fragment for rides whose DEPARTURE carries a clock. The
 * `null` branch is explicit: SQL `NOT IN` drops a NULL row, and every ride
 * written before the column existed is one. A fresh object per call.
 */
export function departureClockedWhere(): {
  OR: Array<{ depPrecision: null } | { depPrecision: { notIn: string[] } }>;
} {
  return {
    OR: [{ depPrecision: null }, { depPrecision: { notIn: [...CLOCKLESS_PRECISIONS] } }],
  };
}

/** The first instant of the day after `day` at `zone`. */
function dayAfterStart(day: string, zone: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return startOfDayAt(next, zone);
}

/**
 * The instant a ride is over: its arrival (else its departure), and for a
 * clockless end the END of that day on the station's calendar — a ride logged
 * for the 5th has not happened at 00:00 on the 5th. A zone-less row keeps the
 * stored instant, the abstention the rest of rail applies to it.
 */
export function rideEndsAt(ride: RailClockFacts): Date {
  const [instant, zone, precision] = ride.arrivalTime
    ? [ride.arrivalTime, ride.arrTimezone, ride.arrPrecision]
    : [ride.departureTime, ride.depTimezone, ride.depPrecision];
  if (endHasClock(precision) || !zone) return instant;
  return dayAfterStart(localDay(instant, zone), zone);
}

/**
 * A ride as a trip's status bounds read it: its departure, and the instant it
 * is over as its "arrival" — so a trip whose last leg is a date-only ride is
 * not completed at the midnight that leg is stored at.
 */
export function rideStatusSpan(ride: RailClockFacts): { departureTime: Date; arrivalTime: Date } {
  return { departureTime: ride.departureTime, arrivalTime: rideEndsAt(ride) };
}

/** The columns `rideStatusSpan` reads, for a Prisma `select`. */
export const RAIL_CLOCK_SELECT = {
  departureTime: true,
  arrivalTime: true,
  depTimezone: true,
  arrTimezone: true,
  depPrecision: true,
  arrPrecision: true,
} as const;
