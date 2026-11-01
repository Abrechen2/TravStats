import { bearingDeg, bearingDeviation, slerp, haversineKm } from "../shared/geo/haversine";
import {
  MASK_COLS,
  MASK_ROWS,
  cellIndex,
  getBit,
  latToRow,
  lonToCol,
} from "../shared/geo/landMaskGrid";

/**
 * Polyline post-processing for the schematic router: simplification,
 * arc-length resampling, u-turn removal and the coast-buffer pass over the
 * fine land mask. Pure functions of their inputs (forgejo#386, REF-16 —
 * extracted from `schematicRouter.ts` unchanged).
 */

/** Look up whether a lat/lon is water on the FINE 0.1° mask. Used
 * only by the coast-buffer post-pass — A* itself runs on the coarse
 * grid. Returns `false` if the mask isn't loaded (caller invokes
 * `loadCoarseMask()` first anyway). */
export function isFineWater(fineBytes: Uint8Array, lat: number, lon: number): boolean {
  if (lat < -90 || lat > 90) return false;
  const row = latToRow(lat);
  const col = lonToCol(lon);
  const c = ((col % MASK_COLS) + MASK_COLS) % MASK_COLS;
  if (row < 0 || row >= MASK_ROWS) return false;
  return getBit(fineBytes, cellIndex(row, c)) === 0;
}

/**
 * Resample a polyline at uniform great-circle arc-length spacing
 * (~`stepKm` between consecutive output vertices). Endpoints are
 * preserved exactly. Intermediate vertices are dropped and replaced
 * with great-circle-interpolated samples spaced evenly along the
 * total polyline length.
 *
 * Why: the marnet graph has clustered duplicate-coordinate nodes near
 * straits (Kiel/Fehmarn, Florida Strait, Bosphorus) that produce
 * 150°+ u-turns in the control polygon. The downstream Catmull-Rom
 * spline can't smooth a sharp control kink into a smooth curve. After
 * arc-length resampling, each cluster collapses into a single
 * interpolated vertex on the route's general bearing, eliminating the
 * u-turn. See `tools/route-audit/harness/` for the empirical study
 * that picked `stepKm=60`.
 *
 * Returns at least the two endpoints. For inputs shorter than the step,
 * returns the input unchanged.
 */
export function arcLengthResample(
  points: ReadonlyArray<[number, number]>,
  stepKm: number
): [number, number][] {
  if (points.length < 2) return points.slice() as [number, number][];
  const segs: number[] = [];
  for (let i = 1; i < points.length; i++) {
    segs.push(
      haversineKm(
        { lat: points[i - 1][1], lon: points[i - 1][0] },
        { lat: points[i][1], lon: points[i][0] }
      )
    );
  }
  const total = segs.reduce((s, x) => s + x, 0);
  if (total < stepKm * 0.5) return points.slice() as [number, number][];
  const cumulative: number[] = [0];
  for (let i = 0; i < segs.length; i++) cumulative.push(cumulative[i] + segs[i]);
  const stepCount = Math.max(2, Math.round(total / stepKm));
  const out: [number, number][] = [[points[0][0], points[0][1]]];
  for (let s = 1; s < stepCount; s++) {
    const target = (s / stepCount) * total;
    let segIdx = 0;
    while (segIdx < segs.length && cumulative[segIdx + 1] < target) segIdx++;
    if (segIdx >= segs.length) break;
    const segStart = cumulative[segIdx];
    const segEnd = cumulative[segIdx + 1];
    const t = (target - segStart) / Math.max(1e-9, segEnd - segStart);
    const a = { lat: points[segIdx][1], lon: points[segIdx][0] };
    const b = { lat: points[segIdx + 1][1], lon: points[segIdx + 1][0] };
    const p = slerp(a, b, t);
    out.push([p.lon, p.lat]);
  }
  out.push([points[points.length - 1][0], points[points.length - 1][1]]);
  return out;
}

/**
 * Douglas-Peucker polyline simplification — drops vertices whose
 * perpendicular distance from the chord between kept vertices is
 * below `toleranceDeg`. Operates in degree space since the output is
 * rendered by a spline that doesn't need metre-accurate vertex
 * placement. Keeps first and last vertices unconditionally.
 */
export function simplifyDegrees(
  points: ReadonlyArray<[number, number]>,
  toleranceDeg: number
): [number, number][] {
  if (points.length <= 2) return points.slice() as [number, number][];

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number];
    if (hi - lo < 2) continue;
    let maxDist = 0;
    let maxIdx = -1;
    const [x0, y0] = points[lo];
    const [x1, y1] = points[hi];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const segLen2 = dx * dx + dy * dy || 1;
    for (let k = lo + 1; k < hi; k++) {
      const [xk, yk] = points[k];
      const t = ((xk - x0) * dx + (yk - y0) * dy) / segLen2;
      const tc = Math.max(0, Math.min(1, t));
      const px = x0 + tc * dx;
      const py = y0 + tc * dy;
      const d = Math.hypot(xk - px, yk - py);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = k;
      }
    }
    if (maxDist > toleranceDeg && maxIdx !== -1) {
      keep[maxIdx] = true;
      stack.push([lo, maxIdx]);
      stack.push([maxIdx, hi]);
    }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Walk each simplified segment at ~0.2° step granularity on the fine
 * 0.1° mask; if the midpoint (or any sampled point) clips land,
 * insert an offshore "buffer" waypoint that pulls the segment out to
 * sea. Runs AFTER Douglas-Peucker so we only buffer segments that
 * actually survived simplification — avoids re-densifying long
 * already-dense continental curves.
 *
 * The buffer direction is chosen by searching a small cloud of
 * offshore candidates perpendicular to the segment and picking the
 * one that gets the whole segment back over water. Cheap because the
 * candidate set is small and the 0.1° mask lookup is O(1).
 */
export function insertCoastBuffers(
  waypoints: ReadonlyArray<[number, number]>,
  fineBytes: Uint8Array | null
): [number, number][] {
  if (fineBytes === null || waypoints.length < 2) {
    return waypoints.slice() as [number, number][];
  }
  const out: [number, number][] = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const [lon0, lat0] = waypoints[i - 1];
    const [lon1, lat1] = waypoints[i];
    const dx = lon1 - lon0;
    const dy = lat1 - lat0;
    const segLen = Math.hypot(dx, dy);
    // Short segments (< 0.5° ≈ 55 km) are too coastal-noisy to buffer
    // usefully, and the spline's natural curvature handles them.
    if (segLen < 0.5) {
      out.push([lon1, lat1]);
      continue;
    }
    // Sample the segment at 0.05° intervals (~5.5 km at the equator).
    // 0.15° was missing islands smaller than the step (Greek islands,
    // Adriatic islets, Stockholm-archipelago skerries) — a chord through
    // such an island samples water on both sides while the actual line
    // cuts the island. 0.05° matches both the new 0.025° fine-mask
    // resolution and the typical width of small islands.
    const samples = Math.max(3, Math.ceil(segLen / 0.05));
    let anyLand = false;
    for (let s = 1; s < samples; s++) {
      const t = s / samples;
      const lon = lon0 + dx * t;
      const lat = lat0 + dy * t;
      if (!isFineWater(fineBytes, lat, lon)) {
        anyLand = true;
        break;
      }
    }
    if (!anyLand) {
      out.push([lon1, lat1]);
      continue;
    }
    // Find an offshore buffer point near the midpoint. Perpendicular
    // vector to the chord, tested in both directions at increasing
    // offset. Cell-size bumps (0.5° steps up to 2°) are enough for
    // continental-scale routing; larger offsets would bend the curve
    // too far.
    const midLon = (lon0 + lon1) / 2;
    const midLat = (lat0 + lat1) / 2;
    const perpNorm = Math.hypot(dx, dy) || 1;
    const perpLon = -dy / perpNorm;
    const perpLat = dx / perpNorm;
    let bestBuffer: [number, number] | null = null;
    for (const magnitude of [0.5, 1.0, 1.5, 2.0]) {
      for (const sign of [1, -1] as const) {
        const bufLon = midLon + sign * perpLon * magnitude;
        const bufLat = midLat + sign * perpLat * magnitude;
        // Accept the buffer only if: (a) it is itself on water, and
        // (b) the two sub-segments (start→buf, buf→end) both stay in
        // water when re-sampled. Otherwise it's still a bad route.
        if (!isFineWater(fineBytes, bufLat, bufLon)) continue;
        if (!segmentAllWater(fineBytes, lon0, lat0, bufLon, bufLat)) continue;
        if (!segmentAllWater(fineBytes, bufLon, bufLat, lon1, lat1)) continue;
        bestBuffer = [bufLon, bufLat];
        break;
      }
      if (bestBuffer !== null) break;
    }
    if (bestBuffer !== null) out.push(bestBuffer);
    out.push([lon1, lat1]);
  }
  return out;
}

export function segmentAllWater(
  fineBytes: Uint8Array,
  lon0: number,
  lat0: number,
  lon1: number,
  lat1: number
): boolean {
  const dx = lon1 - lon0;
  const dy = lat1 - lat0;
  const segLen = Math.hypot(dx, dy);
  const samples = Math.max(3, Math.ceil(segLen / 0.05));
  for (let s = 1; s < samples; s++) {
    const t = s / samples;
    if (!isFineWater(fineBytes, lat0 + dy * t, lon0 + dx * t)) return false;
  }
  return true;
}

export function segmentMaxLandRun(
  fineBytes: Uint8Array,
  lon0: number,
  lat0: number,
  lon1: number,
  lat1: number
): number {
  const dx = lon1 - lon0;
  const dy = lat1 - lat0;
  const segLen = Math.hypot(dx, dy);
  const samples = Math.max(3, Math.ceil(segLen / 0.05));
  let currentRun = 0;
  let maxRun = 0;
  for (let s = 1; s < samples; s++) {
    const t = s / samples;
    if (!isFineWater(fineBytes, lat0 + dy * t, lon0 + dx * t)) {
      currentRun++;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  return maxRun;
}

/**
 * Drop interior nodes that form a U-turn relative to their neighbours —
 * the marnet shipping-graph A* sometimes routes through nodes whose
 * connecting edges flip direction by 120°+. The directional snap fixed
 * the FIRST hop after the corridor exit, but the graph's internal path
 * can still backtrack on later hops (e.g. snap NW of the German Bight,
 * then graph routes through a node SE of the snap before turning back
 * north). Iterates until stable; conservative 120° threshold means
 * legitimate sharp coastal turns (corner of Brittany, North Cape) are
 * preserved.
 */
export function dropUTurnNodes(
  waypoints: ReadonlyArray<[number, number]>,
  thresholdDeg = 120
): [number, number][] {
  let current = waypoints.slice() as [number, number][];
  for (let pass = 0; pass < 10 && current.length > 2; pass++) {
    let changed = false;
    const next: [number, number][] = [current[0]];
    for (let i = 1; i < current.length - 1; i++) {
      const prev = next[next.length - 1];
      const cur = current[i];
      const nxt = current[i + 1];
      const inBearing = bearingDeg({ lat: prev[1], lon: prev[0] }, { lat: cur[1], lon: cur[0] });
      const outBearing = bearingDeg({ lat: cur[1], lon: cur[0] }, { lat: nxt[1], lon: nxt[0] });
      // Going straight: in≈out, deviation ≈ 0°.
      // Right-angle turn: deviation ≈ 90°.
      // Near-u-turn: deviation ≈ 180°.
      // Drop when the turn is sharper than `thresholdDeg`.
      const dev = bearingDeviation(inBearing, outBearing);
      if (dev > thresholdDeg) {
        changed = true;
        continue;
      }
      next.push(cur);
    }
    next.push(current[current.length - 1]);
    if (!changed) break;
    current = next;
  }
  return current;
}
