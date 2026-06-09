import type { RouteMethod, LonLat } from "../types";
import { polylineLengthKm } from "../geo";

/**
 * Perpendicular-offset quadratic Bezier — the curve bends toward the
 * pole (north in the northern hemisphere, south in the southern) so
 * short hops look like proper cruise arcs rather than straight chords.
 * Same formula the TravStats frontend currently uses as its A*
 * fallback. Ignores land; no routing at all.
 */
export const bezierMethod: RouteMethod = {
  id: "bezier",
  label: "Bezier (fallback)",
  color: "#a78bfa",
  description: "Quadratic Bezier, perpendicular offset toward the pole. No land check.",
  defaultOn: true,
  compute: async (pair) => {
    const t0 = performance.now();
    const SAMPLES = 64;
    const a: LonLat = [pair.from.lon, pair.from.lat];
    const b: LonLat = [pair.to.lon, pair.to.lat];

    const midLon = (a[0] + b[0]) / 2;
    const midLat = (a[1] + b[1]) / 2;
    // Perpendicular unit vector to the chord in lon/lat space.
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Curve "height" scales with chord length — shallow for short hops,
    // deeper for transatlantic. Bias toward the closer pole.
    const poleBias = midLat >= 0 ? 1 : -1;
    const amp = Math.min(len * 0.15, 12);
    const ctrl: LonLat = [midLon - (dy / len) * 0, midLat + Math.abs(dy / len) * amp * poleBias];
    // (the ctrl-point formula reuses dy/len defensively; see TravStats
    // frontend for the original intent.)

    const coords: LonLat[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const omt = 1 - t;
      const x = omt * omt * a[0] + 2 * omt * t * ctrl[0] + t * t * b[0];
      const y = omt * omt * a[1] + 2 * omt * t * ctrl[1] + t * t * b[1];
      coords.push([x, y]);
    }
    return {
      coordinates: coords,
      distanceKm: polylineLengthKm(coords),
      computeMs: performance.now() - t0,
    };
  },
};
