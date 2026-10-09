import { classifyPlace, classifyVisit, visitYear } from "../../shared/placeCounting";
import { visitLocalDay } from "../../services/places/visitTrip";
import type { InsightPlace, InsightVisit } from "./types";

/**
 * One counted visit with what every block reads, resolved once.
 *
 * WHAT COUNTS is `shared/placeCounting.ts`: a place must be in the logbook (not
 * the wishlist), a visit dated in the future has not happened, and an undated
 * visit HAS happened — it counts towards how many and towards nothing that
 * asks when. The year is that module's `visitYear` (the place's own calendar);
 * the day is the place's local day where the visit names one.
 */
export interface PreparedVisit {
  visit: InsightVisit;
  place: InsightPlace;
  year: number | null;
  /** `YYYY-MM-DD` at the place, or null when the record names no day. */
  day: string | null;
  /** For ordering: the real instant, else the legacy wall-clock column. */
  instant: number | null;
  /** True when the visit carries a time of day, so two on one day can be ordered. */
  timed: boolean;
}

function dayOf(v: InsightVisit): string | null {
  const local = visitLocalDay(v);
  if (local) return local;
  // A row the time backfill has not reached: its legacy column is the web's
  // wall clock written as if it were UTC, so its UTC date IS the local date —
  // the same fallback `visitYear` makes.
  if (v.visitedAtUtc === null && v.visitedAt !== null)
    return v.visitedAt.toISOString().slice(0, 10);
  return null;
}

export function prepareVisits(
  places: readonly InsightPlace[],
  now: Date
): { counted: PreparedVisit[]; countedPlaces: InsightPlace[]; planned: number } {
  const counted: PreparedVisit[] = [];
  const countedPlaces: InsightPlace[] = [];
  let planned = 0;
  for (const place of places) {
    if (classifyPlace(place) !== "visited") continue;
    countedPlaces.push(place);
    for (const visit of place.visits) {
      const state = classifyVisit(visit, now);
      if (state === "planned") planned += 1;
      if (state !== "visited") continue;
      const at = visit.visitedAtUtc ?? visit.visitedAt;
      counted.push({
        visit,
        place,
        year: visitYear(visit),
        day: dayOf(visit),
        instant: at ? at.getTime() : null,
        timed: visit.visitedPrecision === "minute",
      });
    }
  }
  return { counted, countedPlaces, planned };
}
