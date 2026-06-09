import type { RouteMethod, LonLat } from "../types";
import { polylineLengthKm } from "../geo";
import { loadLandMask } from "../landMask";
import { computeAStar } from "../aStar";

export const aStar005Method: RouteMethod = {
  id: "astar-005",
  label: "A* 0.05° raster",
  color: "#f87171",
  description: "Finer 0.05° raster (~5.5 km cells, 4× data).",
  defaultOn: true,
  compute: async (pair) => {
    const t0 = performance.now();
    const mask = await loadLandMask(0.05);
    const from: LonLat = [pair.from.lon, pair.from.lat];
    const to: LonLat = [pair.to.lon, pair.to.lat];
    const path = computeAStar(from, to, mask);
    const ms = performance.now() - t0;
    if (!path) {
      return {
        coordinates: [from, to],
        distanceKm: polylineLengthKm([from, to]),
        computeMs: ms,
        note: "A* failed — straight chord",
      };
    }
    return {
      coordinates: path,
      distanceKm: polylineLengthKm(path),
      computeMs: ms,
    };
  },
};
