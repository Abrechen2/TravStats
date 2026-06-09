import type { RouteMethod, LonLat } from "../types";
import { polylineLengthKm, slerp } from "../geo";

/**
 * Pure great-circle arc between dep and arr, sampled at 128 points.
 * Ignores land completely — this is the "no routing at all" baseline.
 */
export const greatCircleMethod: RouteMethod = {
  id: "great-circle",
  label: "Great-circle",
  color: "#f472b6",
  description: "128-point spherical geodesic. Ignores continents.",
  defaultOn: true,
  compute: async (pair) => {
    const t0 = performance.now();
    const SAMPLES = 128;
    const a: LonLat = [pair.from.lon, pair.from.lat];
    const b: LonLat = [pair.to.lon, pair.to.lat];
    const coords: LonLat[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      coords.push(slerp(a, b, i / SAMPLES));
    }
    return {
      coordinates: coords,
      distanceKm: polylineLengthKm(coords),
      computeMs: performance.now() - t0,
    };
  },
};
