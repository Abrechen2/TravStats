import { classifyVisit } from "../shared/placeCounting";
import type { Place } from "../types/place";

/**
 * Distinct places a trip counts as visited — "N Orte" on the trip head and the
 * trip card. A place counts when at least ONE of its visits on this trip has
 * happened (`classifyVisit`, the one counting rule); a place with only
 * future-dated visits is planned and counted nowhere, and two visits to the
 * same place are one place (owner decision Q7, 2026-11-20).
 */
export function countTripPlaces(
  placeVisits: readonly { place: Pick<Place, "id">; visit: Parameters<typeof classifyVisit>[0] }[],
  now?: Date
): number {
  const seen = new Set<string>();
  for (const { place, visit } of placeVisits) {
    if (classifyVisit(visit, now) === "visited") seen.add(place.id);
  }
  return seen.size;
}

/**
 * The same figure for every trip at once, from the places the list loaded
 * (visits carry their `tripId`) — the trip list's cards.
 */
export function countPlacesByTrip(places: readonly Place[], now?: Date): Map<string, number> {
  const perTrip = new Map<string, Set<string>>();
  for (const place of places) {
    for (const visit of place.visits) {
      if (!visit.tripId || classifyVisit(visit, now) !== "visited") continue;
      const set = perTrip.get(visit.tripId) ?? new Set<string>();
      set.add(place.id);
      perTrip.set(visit.tripId, set);
    }
  }
  return new Map([...perTrip].map(([tripId, set]) => [tripId, set.size]));
}
