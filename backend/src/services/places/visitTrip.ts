import type { Prisma } from "../../prisma";
import type { DbTransaction } from "../../db";
import { localDay } from "../../shared/time/instant";
import { isValidZone } from "../../shared/time/zonedParts";
import { readDay } from "../timeModel/readDay";

/**
 * The trip a visit belongs to, read off its date (forgejo#199).
 *
 * A visit recorded without a trip — the Companion's "Ort jetzt" sends none —
 * stayed outside the trip it plainly happened on: a place in Seoul on
 * 2026-10-04, saved while the user's only trip ran 03.–19.10., never showed on
 * that trip. The rule that closes it, and nothing more:
 *
 *   - the visit's LOCAL calendar day, on its own clock (`visitedAtUtc` in
 *     `visitedZone`), known to the day at least — a visit dated only to the
 *     month, or with no zone, has no day to compare and is left alone;
 *   - the user's own trips whose span (first to last day, both inclusive)
 *     contains that day — a cancelled trip is not one;
 *   - EXACTLY one such trip → that trip. None, or several, → no trip: two
 *     overlapping trips are a choice for the user, not for a heuristic.
 *
 * Mirrors the rental rule (`rental/rentalLinks.ts`, `soleOverlappingTrip`).
 * The caller decides WHEN to ask: only for a visit whose writer named no trip
 * at all. A writer that sent `tripId: null` said "no trip", and is believed.
 */

export interface VisitDayColumns {
  visitedAtUtc: Date | null;
  visitedZone: string | null;
  visitedPrecision: string | null;
}

export interface TripSpanColumns {
  id: string;
  startDay: Date | null;
  endDay: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  startZone: string | null;
  endZone: string | null;
}

/** Precisions that name a calendar day. */
const DAY_PRECISE = new Set(["minute", "day"]);

/** The visit's calendar day at the place, or null when it cannot be known. */
export function visitLocalDay(v: VisitDayColumns): string | null {
  if (!v.visitedAtUtc || !v.visitedZone || !isValidZone(v.visitedZone)) return null;
  if (!v.visitedPrecision || !DAY_PRECISE.has(v.visitedPrecision)) return null;
  return localDay(v.visitedAtUtc, v.visitedZone);
}

/** A trip's first and last day, by the read side's own rule (`readDay`). */
export function tripSpan(t: TripSpanColumns): { first: string; last: string } | null {
  const first = readDay(t.startDay, t.startDate, t.startZone)?.date ?? null;
  const last = readDay(t.endDay, t.endDate, t.endZone)?.date ?? null;
  const from = first ?? last;
  const to = last ?? first;
  return from && to ? { first: from, last: to } : null;
}

/** Every trip whose span holds `day`, both ends inclusive. */
export function tripsForDay<T extends TripSpanColumns>(day: string, trips: readonly T[]): T[] {
  return trips.filter((t) => {
    const span = tripSpan(t);
    return span !== null && span.first <= day && day <= span.last;
  });
}

/** The one trip whose span holds `day`, or null for none or several. */
export function soleTripForDay(day: string, trips: readonly TripSpanColumns[]): string | null {
  const matches = tripsForDay(day, trips);
  return matches.length === 1 ? matches[0].id : null;
}

export const TRIP_SPAN_SELECT = {
  id: true,
  name: true,
  startDay: true,
  endDay: true,
  startDate: true,
  endDate: true,
  startZone: true,
  endZone: true,
} as const satisfies Prisma.TripSelect;

/** The client or a transaction — anything that can read trips. */
type TripReader = Pick<DbTransaction, "trip">;

/** The user's trips that can hold a visit — every one but a cancelled trip. */
export function loadTripSpans(
  client: TripReader,
  userId: string
): Promise<Array<TripSpanColumns & { name: string }>> {
  return client.trip.findMany({
    where: { userId, status: { not: "cancelled" } },
    select: TRIP_SPAN_SELECT,
  });
}

/** The trip a new, trip-less visit joins by itself, or null (see the module note). */
export async function tripForVisitDay(
  client: TripReader,
  userId: string,
  visit: VisitDayColumns
): Promise<string | null> {
  const day = visitLocalDay(visit);
  if (!day) return null;
  return soleTripForDay(day, await loadTripSpans(client, userId));
}
