import { classifyVisit } from "../../shared/placeCounting";
import type { Place } from "../../types/place";
import { intervalOverlapsRange, type TimeRange } from "../../store/dashboardFilterStore";

/**
 * The map's year filter for the tabs that hold routes or places of their own (tour, roadtrip,
 * POI). It is the rule the "Alle" tab applies, in one place: no range = everything; a tour is
 * kept when its dates overlap the range, and one with no date (it occupies no known day) stays;
 * a place is kept when one of its counted visits falls in the range, and one whose visits carry
 * no date steps aside while a range is set.
 */

const isOpen = (range: TimeRange): boolean => !range.from && !range.to;

export function toursInRange<T extends { startDate: string | null; endDate: string | null }>(
  tours: readonly T[],
  range: TimeRange
): T[] {
  if (isOpen(range)) return [...tours];
  return tours.filter(
    (tour) =>
      !tour.startDate || intervalOverlapsRange(tour.startDate, tour.endDate, range.from, range.to)
  );
}

export function placesInRange(places: readonly Place[], range: TimeRange): Place[] {
  if (isOpen(range)) return [...places];
  return places.filter((place) =>
    place.visits.some(
      (visit) =>
        visit.visitedAt !== null &&
        classifyVisit(visit) === "visited" &&
        intervalOverlapsRange(visit.visitedAt, visit.visitedAt, range.from, range.to)
    )
  );
}
