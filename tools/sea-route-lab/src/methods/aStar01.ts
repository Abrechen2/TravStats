import type { RouteMethod, LonLat } from "../types";
import { polylineLengthKm } from "../geo";
import { loadLandMask } from "../landMask";
import { computeAStar } from "../aStar";

export const aStar01Method: RouteMethod = {
  id: "astar-01",
  label: "A* 0.1° raster",
  color: "#38bdf8",
  description: "Status-quo cell-center path. 0.1° ≈ 11 km cells.",
  defaultOn: true,
  compute: async (pair) => {
    const t0 = performance.now();
    const mask = await loadLandMask(0.1);
    const from: LonLat = [pair.from.lon, pair.from.lat];
    const to: LonLat = [pair.to.lon, pair.to.lat];
    const path = computeAStar(from, to, mask);
    const ms = performance.now() - t0;
    if (!path) {
      return {
        coordinates: [from, to],
        distanceKm: polylineLengthKm([from, to]),
        computeMs: ms,
        note: "A* failed — showing straight chord",
      };
    }
    return {
      coordinates: path,
      distanceKm: polylineLengthKm(path),
      computeMs: ms,
    };
  },
};
