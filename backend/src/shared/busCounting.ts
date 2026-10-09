/**
 * Single source of truth for "does this bus ride count, and when".
 *
 * The sibling of `railCounting.ts` (spec 2026-10-07-bus-domain-design §4): every
 * bus figure — the statistics (B2), the cross-domain overview, the evidence
 * behind it — asks here, so no two of them can disagree about which rides are
 * counted. Written as its own module rather than an alias of rail's, so a
 * later ruling on one domain cannot change the other in silence; the tests on
 * both pin the same truth table today.
 *
 * One status means the ride happened: `completed`. A ride counts on the
 * calendar of its TERMINALS, not of the reader or of UTC — a night coach that
 * leaves Berlin at 23:30 on the 31st is a ride of the old year.
 *
 * MIRRORED in `frontend/src/shared/busCounting.ts`. Change both together.
 */

import { localDay } from "./time/instant";

export const COUNTABLE_BUS_STATUSES = ["completed"] as const;

export interface CountableBus {
  status: string;
}

/** The Prisma `where` fragment: `{ userId, ...countableBusWhere() }`. A fresh object per call. */
export function countableBusWhere(): { status: { in: string[] } } {
  return { status: { in: [...COUNTABLE_BUS_STATUSES] } };
}

export function isCountableBus(ride: CountableBus): boolean {
  return (COUNTABLE_BUS_STATUSES as readonly string[]).includes(ride.status);
}

export interface DatedBus {
  departureTime: Date;
  arrivalTime: Date | null;
  depTimezone: string | null;
  arrTimezone: string | null;
}

/** `YYYY-MM-DD` on the terminal's clock; a zone-less row (the abstention) reads as UTC. */
function terminalDayKey(instant: Date, timezone: string | null): string {
  return localDay(instant, timezone ?? "UTC");
}

/**
 * The days a ride was travelled on: the departure day at the departure
 * terminal, and the arrival day at the arrival terminal when that is another
 * day. A ride with no known arrival is a one-day event, not an invented length.
 */
export function busDayKeys(ride: DatedBus): string[] {
  const dep = terminalDayKey(ride.departureTime, ride.depTimezone);
  if (!ride.arrivalTime) return [dep];
  const arr = terminalDayKey(ride.arrivalTime, ride.arrTimezone);
  return arr === dep ? [dep] : [dep, arr];
}

/** The year a ride is filed under: the year it LEFT, on its terminal's calendar. */
export function busYear(ride: DatedBus): number {
  return Number(terminalDayKey(ride.departureTime, ride.depTimezone).slice(0, 4));
}

/** The countries a ride proves: both terminals', when known. Never guessed. */
export function busCountries(ride: {
  depCountry: string | null;
  arrCountry: string | null;
}): string[] {
  const codes = [ride.depCountry, ride.arrCountry]
    .filter((c): c is string => typeof c === "string" && /^[A-Za-z]{2}$/.test(c))
    .map((c) => c.toUpperCase());
  return [...new Set(codes)];
}
