import type { LonLat } from "./types";

/**
 * Chaikin's corner-cutting algorithm — takes each segment `[p, q]` and
 * replaces it with two points at 25% and 75% along it. Endpoints stay
 * pinned. Each iteration doubles the vertex count but rounds every
 * corner; 2 iterations is usually enough to hide the raster's step-
 * stair artefacts without obliterating real coastline bends.
 */
export function chaikin(coords: LonLat[], iterations = 2): LonLat[] {
  if (coords.length < 3 || iterations <= 0) return coords;
  let cur: LonLat[] = coords;
  for (let it = 0; it < iterations; it++) {
    const next: LonLat[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const p = cur[i];
      const q = cur[i + 1];
      next.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      next.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/**
 * Catmull-Rom spline through `coords`. Returns a polyline with
 * `samplesPerSegment` points interpolated between each original pair.
 * Uses the uniform variant (alpha = 0). Endpoints are duplicated as
 * phantom handles so the first / last segments are real curves, not
 * straight lines.
 */
export function catmullRom(coords: LonLat[], samplesPerSegment = 8): LonLat[] {
  if (coords.length < 2) return coords;
  const pts: LonLat[] = [coords[0], ...coords, coords[coords.length - 1]];
  const out: LonLat[] = [coords[0]];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2];
    for (let s = 1; s <= samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  return out;
}
