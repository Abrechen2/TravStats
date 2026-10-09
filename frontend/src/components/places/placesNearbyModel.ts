import { calculateDistance } from "../../lib/geo";
import { classifyPlace, type PlaceCountState } from "../../shared/placeCounting";
import type { PlaceCategory } from "../../shared/placeCategories";
import type { Place } from "../../types/place";

/** Where "nearby" is measured from — a lodging, a point on the map, or the device, once. */
export interface NearbyOrigin {
  lat: number;
  lon: number;
}

/** The radii offered, in km. Small enough for a walk, large enough for a day trip. */
export const NEARBY_RADII_KM = [0.5, 1, 2, 5, 10, 25, 50] as const;
export const DEFAULT_RADIUS_KM = 5;

export interface NearbyFilter {
  radiusKm: number;
  category: PlaceCategory | "all";
  /** Which of the three states to show; all three by default. */
  states: ReadonlySet<PlaceCountState>;
}

export interface NearbyPlace {
  place: Place;
  km: number;
  /** visited / planned / excluded (= saved, on the wishlist) — from `shared/placeCounting`. */
  state: PlaceCountState;
}

/**
 * The user's own places within the radius, nearest first (forgejo#233).
 *
 * Only places already saved — this is the logbook seen from where one stands,
 * not a search for new ones (that is the geocoder's "nearby", which stays
 * where it is). Whether a place counts as visited, planned or saved comes from
 * `classifyPlace`, the one home of that rule; this only filters and sorts.
 */
export function nearbyPlaces(
  places: readonly Place[],
  origin: NearbyOrigin,
  filter: NearbyFilter
): NearbyPlace[] {
  return places
    .map((place) => ({
      place,
      km: calculateDistance(origin.lat, origin.lon, place.lat, place.lon),
      state: classifyPlace(place),
    }))
    .filter(
      (row) =>
        row.km <= filter.radiusKm &&
        (filter.category === "all" || row.place.category === filter.category) &&
        filter.states.has(row.state)
    )
    .sort((a, b) => a.km - b.km || a.place.name.localeCompare(b.place.name));
}

/** The next radius up, for "nothing within this radius" — null at the largest. */
export function widerRadius(km: number): number | null {
  return NEARBY_RADII_KM.find((r) => r > km) ?? null;
}
