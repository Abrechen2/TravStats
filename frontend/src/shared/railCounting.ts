import { isValidZone, localDay } from "./time";

/**
 * Single source of truth for "does this train ride count, and when".
 *
 * The sibling of `flightCounting.ts`, `cruiseCounting.ts`, `lodgingCounting.ts`
 * and `placeCounting.ts` (spec 2026-09-25-rail-domain, phase 2b). Every rail
 * figure — the statistics, the cross-domain overview, the evidence behind it —
 * asks here, so no two of them can disagree about which rides are counted.
 *
 * One status means the ride happened: `completed` (it has arrived). The others
 * do not: `scheduled` and `in_progress` have not finished yet, and `cancelled`
 * never will. A ride counts on the calendar of its STATIONS, not of the reader
 * or of UTC — the Nachtzug that leaves Vienna at 22:58 on the 31st is a ride of
 * the old year on the day it left and of the new year on the day it arrived.
 *
 * MIRRORED from `backend/src/shared/railCounting.ts`. Change both together.
 * The one difference: instants arrive as ISO strings here, as the API sends them.
 */

export const COUNTABLE_RAIL_STATUSES = ["completed"] as const;

/**
 * What a stored journey was: a train (`rail`), or a U-Bahn or tram ride the
 * user chose to keep (the bahn.de import, 2026-10-23). The owner's rule: a
 * metro or tram ride is stored and listed, on its trip and in the journey
 * list, but it is not a train ride and counts in NO rail figure — rides,
 * kilometres, records, map cards, countries, travel days. Every such figure
 * reaches it through `isCountableRail` / `countableRailWhere` below, so the
 * exclusion has this one home.
 */
export const RAIL_TRANSIT_MODES = ["rail", "metro", "tram"] as const;
export type RailTransitMode = (typeof RAIL_TRANSIT_MODES)[number];
export const COUNTED_RAIL_TRANSIT_MODES = ["rail"] as const;

export interface CountableRail {
  status: string;
  /** Required on purpose: a select that forgot the column would count a tram ride. */
  transitMode: string;
}

/** The status half of the rule alone: the ride happened. Not a counting rule by itself. */
export function isCompletedRail(ride: { status: string }): boolean {
  return (COUNTABLE_RAIL_STATUSES as readonly string[]).includes(ride.status);
}

/** The mode half alone, for a figure that keeps its own status rule (a trip's countries). */
export function countedRailModeWhere(): { transitMode: { in: string[] } } {
  return { transitMode: { in: [...COUNTED_RAIL_TRANSIT_MODES] } };
}

export function isCountedRailMode(ride: { transitMode: string }): boolean {
  return (COUNTED_RAIL_TRANSIT_MODES as readonly string[]).includes(ride.transitMode);
}

/** The Prisma `where` fragment: `{ userId, ...countableRailWhere() }`. A fresh object per call. */
export function countableRailWhere(): {
  status: { in: string[] };
  transitMode: { in: string[] };
} {
  return { status: { in: [...COUNTABLE_RAIL_STATUSES] }, ...countedRailModeWhere() };
}

export function isCountableRail(ride: CountableRail): boolean {
  return isCompletedRail(ride) && isCountedRailMode(ride);
}

/**
 * `YYYY-MM-DD` of an instant on a station's clock. A station the server could
 * not place in a zone stored its wall clock as UTC (the spec's abstention), so
 * UTC is then the honest way back — the same rule `lib/railTime.ts` shows.
 */
export function stationDayKey(instant: Date | string, timezone: string | null): string {
  // A zone this runtime's Intl does not know threw a RangeError and took the
  // statistics page down with it; such a ride is read in UTC, the reading the
  // server stores for a place it could not put in a zone.
  return localDay(instant, timezone && isValidZone(timezone) ? timezone : "UTC");
}

export interface DatedRail {
  departureTime: Date | string;
  arrivalTime: Date | string | null;
  depTimezone: string | null;
  arrTimezone: string | null;
}

/**
 * The days a ride was travelled on: the departure day at the departure station,
 * and the arrival day at the arrival station when that is another day. A ride
 * with no known arrival is a one-day event rather than an invented length.
 */
export function railDayKeys(ride: DatedRail): string[] {
  const dep = stationDayKey(ride.departureTime, ride.depTimezone);
  if (!ride.arrivalTime) return [dep];
  const arr = stationDayKey(ride.arrivalTime, ride.arrTimezone);
  return arr === dep ? [dep] : [dep, arr];
}

/** The year a ride is filed under: the year it LEFT, on its station's calendar. */
export function railYear(ride: DatedRail): number {
  return Number(stationDayKey(ride.departureTime, ride.depTimezone).slice(0, 4));
}

/** The countries a ride proves: both stations', when known. Never guessed. */
export function railCountries(ride: {
  depCountry: string | null;
  arrCountry: string | null;
}): string[] {
  const codes = [ride.depCountry, ride.arrCountry]
    .filter((c): c is string => typeof c === "string" && /^[A-Za-z]{2}$/.test(c))
    .map((c) => c.toUpperCase());
  return [...new Set(codes)];
}
