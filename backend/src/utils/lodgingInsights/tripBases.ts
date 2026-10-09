import type { Prepared, PreparedStay } from "./prepare";
import type { InsightTrip, TripBase, TripBases } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Longest run of consecutive night dates in a set. */
function longestRun(days: Iterable<number>): number {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    run = i > 0 && sorted[i] - sorted[i - 1] === DAY_MS ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Moves between houses on one trip, and the longest stretch at one base
 * (forgejo#258 item 3).
 *
 * Only stays filed under a trip take part — the trip is what says these nights
 * belong together — and only those with two real dates can be put in order.
 * Two bookings that hold the same night at DIFFERENT houses (a changed plan, a
 * second room) are reported as `overlapNights` instead of being read as a move
 * there and back; at the SAME house they simply merge.
 */
function baseOf(trip: InsightTrip, stays: PreparedStay[], completed: boolean): TripBase | null {
  const dated = stays
    .filter((p) => p.nightDays.length > 0)
    .sort((a, b) => a.nightDays[0] - b.nightDays[0]);
  if (dated.length === 0) return null;

  let changes = 0;
  for (let i = 1; i < dated.length; i += 1) {
    if (dated[i].stay.lodgingId !== dated[i - 1].stay.lodgingId) changes += 1;
  }

  const nightsByHouse = new Map<string, number[]>();
  const housesPerNight = new Map<number, Set<string>>();
  for (const p of dated) {
    const list = nightsByHouse.get(p.stay.lodgingId) ?? [];
    list.push(...p.nightDays);
    nightsByHouse.set(p.stay.lodgingId, list);
    for (const day of p.nightDays) {
      const houses = housesPerNight.get(day) ?? new Set<string>();
      houses.add(p.stay.lodgingId);
      housesPerNight.set(day, houses);
    }
  }

  let longestBaseNights = 0;
  let longestBaseLodgingId = dated[0].stay.lodgingId;
  for (const [lodgingId, days] of nightsByHouse) {
    const run = longestRun(days);
    if (run > longestBaseNights) {
      longestBaseNights = run;
      longestBaseLodgingId = lodgingId;
    }
  }
  const baseName =
    dated.find((p) => p.stay.lodgingId === longestBaseLodgingId)?.stay.lodgingName ?? "";

  return {
    tripId: trip.id,
    tripName: trip.name,
    year: new Date(dated[0].nightDays[0]).getUTCFullYear(),
    houses: new Set(stays.map((p) => p.stay.lodgingId)).size,
    changes,
    longestBaseNights,
    longestBaseLodgingId,
    longestBaseName: baseName,
    overlapNights: [...housesPerNight.values()].filter((h) => h.size > 1).length,
    types: [...new Set(stays.map((p) => p.stay.type))].sort(),
    completed,
  };
}

export function computeTripBases(prepared: Prepared, now: Date): TripBases {
  const byTrip = new Map<string, { trip: InsightTrip; stays: PreparedStay[] }>();
  let staysWithoutTrip = 0;
  let undatedTripStays = 0;
  for (const p of prepared.counted) {
    if (!p.stay.trip) {
      staysWithoutTrip += 1;
      continue;
    }
    if (p.nightDays.length === 0) undatedTripStays += 1;
    const entry = byTrip.get(p.stay.trip.id) ?? { trip: p.stay.trip, stays: [] };
    entry.stays.push(p);
    byTrip.set(p.stay.trip.id, entry);
  }

  const trips: TripBase[] = [];
  let typesPerCompletedTripMax = 0;
  for (const { trip, stays } of byTrip.values()) {
    // Completed: nothing of it is still ahead — no stay waiting for its
    // check-out, and the trip's own recorded end (when there is one) is past.
    const completed =
      !prepared.tripsWithPlannedStays.has(trip.id) &&
      (trip.endDate === null || trip.endDate.getTime() < now.getTime());
    if (completed) {
      const types = new Set(stays.map((p) => p.stay.type)).size;
      if (types > typesPerCompletedTripMax) typesPerCompletedTripMax = types;
    }
    const base = baseOf(trip, stays, completed);
    if (base) trips.push(base);
  }
  trips.sort((a, b) => b.year - a.year || b.changes - a.changes);
  return { trips, staysWithoutTrip, undatedTripStays, typesPerCompletedTripMax };
}
