import type { RouteMethod, LonLat } from "../types";
import { polylineLengthKm } from "../geo";
import { loadLandMask } from "../landMask";
import { computeAStar } from "../aStar";
import { chaikin } from "../smoothing";

export const aStar01ChaikinMethod: RouteMethod = {
  id: "astar-01-chaikin",
  label: "A* 0.1° + Chaikin ×2",
  color: "#34d399",
  description: "A* path smoothed by 2 Chaikin iterations — rounds raster corners.",
  defaultOn: true,
  compute: async (pair) => {
    const t0 = performance.now();
    const mask = await loadLandMask(0.1);
    const from: LonLat = [pair.from.lon, pair.from.lat];
    const to: LonLat = [pair.to.lon, pair.to.lat];
    const raw = computeAStar(from, to, mask);
    const ms = performance.now() - t0;
    if (!raw) {
      return {
        coordinates: [from, to],
        distanceKm: polylineLengthKm([from, to]),
        computeMs: ms,
        note: "A* failed — straight chord",
      };
    }
    const smoothed = chaikin(raw, 2);
    return {
      coordinates: smoothed,
      distanceKm: polylineLengthKm(smoothed),
      computeMs: ms,
    };
  },
};
