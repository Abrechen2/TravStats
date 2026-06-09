import type { RouteMethod, LonLat } from "../types";
import { polylineLengthKm } from "../geo";
import { loadLandMask } from "../landMask";
import { computeAStar } from "../aStar";
import { catmullRom } from "../smoothing";

export const aStar01CatmullRomMethod: RouteMethod = {
  id: "astar-01-catmull",
  label: "A* 0.1° + Catmull-Rom",
  color: "#fbbf24",
  description: "A* path interpolated through a Catmull-Rom spline (8 samples/segment).",
  defaultOn: false,
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
    const smoothed = catmullRom(raw, 8);
    return {
      coordinates: smoothed,
      distanceKm: polylineLengthKm(smoothed),
      computeMs: ms,
    };
  },
};
