import { polylineLengthKm } from "../../shared/geo/haversine";

/**
 * Length of a hand-drawn route, in kilometres.
 *
 * Input is GeoJSON order — `[lon, lat]` — because that is what
 * `CruiseLegRoute.waypoints` stores and what the geometry endpoint emits, and
 * a conversion in between would be one more place to get it backwards.
 *
 * Deliberately a plain sum of great-circle segments (delegated to the shared
 * `polylineLengthKm`, the same accumulator `marnetCalculator` already uses):
 * the total of a route and the totals of its parts must add up to the same
 * value at any scale that matters, or splitting a leg at a landing would move
 * the cruise's distance (spec §6.2). Floating-point addition is not
 * associative, so "the same value" means "within floating-point tolerance",
 * not bit-for-bit identical.
 */
export function polylineDistanceKm(waypoints: Array<[number, number]>): number {
  return polylineLengthKm(waypoints.map(([lon, lat]) => ({ lat, lon })));
}
