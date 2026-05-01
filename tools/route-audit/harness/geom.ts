/**
 * Shared geometry helpers used by multiple strategies — arc-length
 * resampling, Chaikin corner-cutting, Laplacian smoothing, centripetal
 * Catmull-Rom evaluation, perpendicular offset by a coast distance
 * field, etc.
 *
 * Each helper is pure, takes/returns plain `[lon, lat]` arrays, and
 * does NO i/o. Land-mask access is via callbacks injected from the
 * runner — keeps the helpers testable in isolation.
 */
import { haversineKm, slerp } from '../../../backend/src/shared/geo/haversine';
import type { Waypoint } from './types';

export type LonLat = [number, number];

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Convert [lon, lat] degree array to {lat, lon} for haversine calls. */
export function ll(p: Waypoint): { lat: number; lon: number } {
  return { lat: p[1], lon: p[0] };
}

export function chordLengthKm(coords: ReadonlyArray<Waypoint>): number {
  if (coords.length < 2) return 0;
  return haversineKm(ll(coords[0]), ll(coords[coords.length - 1]));
}

export function polylineKm(coords: ReadonlyArray<Waypoint>): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversineKm(ll(coords[i - 1]), ll(coords[i]));
  return km;
}

/** Resample a polyline at ~`stepKm` great-circle spacing. Endpoints
 * preserved; intermediate vertices ignored — we walk the original
 * polyline accumulating arc length and emit a new vertex every
 * `stepKm`. Useful to wash out "44 km then 3 km" segment-length noise
 * before smoothing. */
export function resampleArcLength(coords: ReadonlyArray<Waypoint>, stepKm: number): LonLat[] {
  if (coords.length < 2) return coords.map((c) => [c[0], c[1]] as LonLat);
  const total = polylineKm(coords);
  if (total < stepKm * 0.5) return coords.map((c) => [c[0], c[1]] as LonLat);
  const segs: number[] = [];
  for (let i = 1; i < coords.length; i++) {
    segs.push(haversineKm(ll(coords[i - 1]), ll(coords[i])));
  }
  const cumulative: number[] = [0];
  for (let i = 0; i < segs.length; i++) cumulative.push(cumulative[i] + segs[i]);

  const stepCount = Math.max(2, Math.round(total / stepKm));
  const out: LonLat[] = [[coords[0][0], coords[0][1]]];
  for (let s = 1; s < stepCount; s++) {
    const target = (s / stepCount) * total;
    let segIdx = 0;
    while (segIdx < segs.length && cumulative[segIdx + 1] < target) segIdx++;
    if (segIdx >= segs.length) break;
    const segStart = cumulative[segIdx];
    const segEnd = cumulative[segIdx + 1];
    const t = (target - segStart) / Math.max(1e-9, segEnd - segStart);
    const p = slerp(ll(coords[segIdx]), ll(coords[segIdx + 1]), t);
    out.push([p.lon, p.lat]);
  }
  out.push([coords[coords.length - 1][0], coords[coords.length - 1][1]]);
  return out;
}

/** Chaikin corner-cutting: for each interior segment a→b, replace with
 * Q = a + 1/4(b-a), R = a + 3/4(b-a). Endpoints preserved. n iterations
 * smooth progressively. Operates in lon/lat degree space — accurate
 * enough for visual smoothing at cruise-route scale. */
export function chaikin(coords: ReadonlyArray<Waypoint>, iterations: number): LonLat[] {
  let work: LonLat[] = coords.map((c) => [c[0], c[1]] as LonLat);
  for (let it = 0; it < iterations; it++) {
    if (work.length < 3) break;
    const next: LonLat[] = [work[0]];
    for (let i = 0; i < work.length - 1; i++) {
      const a = work[i];
      const b = work[i + 1];
      next.push([a[0] + 0.25 * (b[0] - a[0]), a[1] + 0.25 * (b[1] - a[1])]);
      next.push([a[0] + 0.75 * (b[0] - a[0]), a[1] + 0.75 * (b[1] - a[1])]);
    }
    next.push(work[work.length - 1]);
    work = next;
  }
  return work;
}

/** Laplacian smoothing: each interior point becomes the average of its
 * neighbours. Endpoints preserved. Stronger smoothing than Chaikin per
 * iteration but more prone to land-clipping. */
export function laplacian(coords: ReadonlyArray<Waypoint>, iterations: number): LonLat[] {
  let work: LonLat[] = coords.map((c) => [c[0], c[1]] as LonLat);
  for (let it = 0; it < iterations; it++) {
    if (work.length < 3) break;
    const next: LonLat[] = [work[0]];
    for (let i = 1; i < work.length - 1; i++) {
      const a = work[i - 1];
      const b = work[i];
      const c = work[i + 1];
      next.push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]);
    }
    next.push(work[work.length - 1]);
    work = next;
  }
  return work;
}

/** Centripetal Catmull-Rom evaluation. Given a control polygon, sample
 * the cubic spline at `samplesPerSegment` points per segment with
 * α=0.5. Endpoint phantoms are extrapolated by reflection of the
 * adjacent segment so the curve enters and leaves with the chord
 * direction (the duplicate-point trick gives degenerate t-values and
 * blows the formula up). Returns a dense polyline (control +
 * interpolated points). */
export function catmullRomCentripetal(
  control: ReadonlyArray<Waypoint>,
  samplesPerSegment: number,
): LonLat[] {
  if (control.length < 2) return control.map((c) => [c[0], c[1]] as LonLat);
  const c0 = control[0];
  const c1 = control[1];
  const cN1 = control[control.length - 2];
  const cN = control[control.length - 1];
  const phantomStart: LonLat = [2 * c0[0] - c1[0], 2 * c0[1] - c1[1]];
  const phantomEnd: LonLat = [2 * cN[0] - cN1[0], 2 * cN[1] - cN1[1]];
  const pts: LonLat[] = [
    phantomStart,
    ...control.map((c) => [c[0], c[1]] as LonLat),
    phantomEnd,
  ];

  const out: LonLat[] = [[control[0][0], control[0][1]]];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2];
    // α = 0.5 → t_{n+1} = t_n + |p_{n+1} - p_n|^0.5
    const t0 = 0;
    const t1 = t0 + Math.sqrt(Math.max(1e-6, Math.hypot(p1[0] - p0[0], p1[1] - p0[1])));
    const t2 = t1 + Math.sqrt(Math.max(1e-6, Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
    const t3 = t2 + Math.sqrt(Math.max(1e-6, Math.hypot(p3[0] - p2[0], p3[1] - p2[1])));
    for (let s = 1; s <= samplesPerSegment; s++) {
      const t = t1 + (t2 - t1) * (s / samplesPerSegment);
      out.push(catmullPoint(p0, p1, p2, p3, t0, t1, t2, t3, t));
    }
  }
  return out;
}

function catmullPoint(
  p0: LonLat, p1: LonLat, p2: LonLat, p3: LonLat,
  t0: number, t1: number, t2: number, t3: number, t: number,
): LonLat {
  const a1x = ((t1 - t) * p0[0] + (t - t0) * p1[0]) / Math.max(1e-9, t1 - t0);
  const a1y = ((t1 - t) * p0[1] + (t - t0) * p1[1]) / Math.max(1e-9, t1 - t0);
  const a2x = ((t2 - t) * p1[0] + (t - t1) * p2[0]) / Math.max(1e-9, t2 - t1);
  const a2y = ((t2 - t) * p1[1] + (t - t1) * p2[1]) / Math.max(1e-9, t2 - t1);
  const a3x = ((t3 - t) * p2[0] + (t - t2) * p3[0]) / Math.max(1e-9, t3 - t2);
  const a3y = ((t3 - t) * p2[1] + (t - t2) * p3[1]) / Math.max(1e-9, t3 - t2);
  const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / Math.max(1e-9, t2 - t0);
  const b1y = ((t2 - t) * a1y + (t - t0) * a2y) / Math.max(1e-9, t2 - t0);
  const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / Math.max(1e-9, t3 - t1);
  const b2y = ((t3 - t) * a2y + (t - t1) * a3y) / Math.max(1e-9, t3 - t1);
  return [
    ((t2 - t) * b1x + (t - t1) * b2x) / Math.max(1e-9, t2 - t1),
    ((t2 - t) * b1y + (t - t1) * b2y) / Math.max(1e-9, t2 - t1),
  ];
}

/** Sample a great-circle from `dep` to `arr` at `n` points. */
export function sampleGreatCircle(
  dep: { lat: number; lon: number },
  arr: { lat: number; lon: number },
  n: number,
): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = slerp(dep, arr, t);
    out.push([p.lon, p.lat]);
  }
  return out;
}

/** Reject same-point duplicates. */
export function dedupe(coords: ReadonlyArray<Waypoint>, epsDeg = 1e-6): LonLat[] {
  const out: LonLat[] = [];
  for (const c of coords) {
    if (out.length === 0) {
      out.push([c[0], c[1]]);
      continue;
    }
    const last = out[out.length - 1];
    if (Math.abs(last[0] - c[0]) < epsDeg && Math.abs(last[1] - c[1]) < epsDeg) continue;
    out.push([c[0], c[1]]);
  }
  return out;
}

/** Bearing-deviation-based vertex pruning. Removes any interior vertex
 * whose incoming/outgoing bearing flips by more than `maxTurnDeg`,
 * provided the bypass segment satisfies `acceptBypass(prev, next)`.
 * Multiple passes until convergence. */
export function pruneSpikes(
  coords: ReadonlyArray<Waypoint>,
  maxTurnDeg: number,
  acceptBypass: (prev: Waypoint, next: Waypoint) => boolean,
  maxPasses = 5,
): LonLat[] {
  let work: LonLat[] = coords.map((c) => [c[0], c[1]] as LonLat);
  for (let pass = 0; pass < maxPasses; pass++) {
    if (work.length < 3) break;
    const next: LonLat[] = [work[0]];
    let removed = 0;
    for (let i = 1; i < work.length - 1; i++) {
      const prev = next[next.length - 1];
      const curr = work[i];
      const fwd = work[i + 1];
      const bIn = bearing(prev, curr);
      const bOut = bearing(curr, fwd);
      const dev = devDeg(bIn, bOut);
      if (dev >= maxTurnDeg && acceptBypass(prev, fwd)) {
        removed++;
        continue;
      }
      next.push(curr);
    }
    next.push(work[work.length - 1]);
    if (removed === 0) break;
    work = next;
  }
  return work;
}

function bearing(a: LonLat, b: LonLat): number {
  const lat1 = a[1] * RAD;
  const lat2 = b[1] * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * DEG) + 360) % 360;
}

function devDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
