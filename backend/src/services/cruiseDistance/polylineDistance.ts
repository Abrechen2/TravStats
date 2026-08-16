import { haversineKm } from "../../shared/geo/haversine";

/**
 * Length of a hand-drawn route, in kilometres.
 *
 * Input is GeoJSON order — `[lon, lat]` — because that is what
 * `CruiseLegRoute.waypoints` stores and what the geometry endpoint emits, and
 * a conversion in between would be one more place to get it backwards.
 *
 * Deliberately a plain sum of great-circle segments: the total of a route and
 * the totals of its parts must add up exactly, or splitting a leg at a landing
 * would move the cruise's distance (spec §6.2).
 */
export function polylineDistanceKm(waypoints: Array<[number, number]>): number {
  let km = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const [aLon, aLat] = waypoints[i - 1];
    const [bLon, bLat] = waypoints[i];
    km += haversineKm({ lat: aLat, lon: aLon }, { lat: bLat, lon: bLon });
  }
  return km;
}
