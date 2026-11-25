import { haversineKm } from "../../../shared/geo/haversine";
import type { StoredPoint } from "../../tripRecording/segments";

/**
 * Light smoothing of a sparse or noisy TravTrack line, for DRAWING only
 * (forgejo rc46 extras, part C1). A speed-gated moving median, nothing
 * cleverer: no Kalman filter, no model of motion, so it can be checked by
 * hand against the table in its test.
 *
 * - Each vertex is replaced by the median latitude and the median longitude
 *   of the vertices within `windowMs` of it (itself included), the same
 *   number on each side and at most `halfWindow`.
 * - The gate: a window whose first and last vertex lie further apart than
 *   `gateMps` allows for the time between them is real fast travel (a train,
 *   a plane), and its vertex stays exactly where it was. Smoothing a fast
 *   stretch would cut its corners and shorten it.
 * - The first and last vertex of a segment never move, so a line still starts
 *   and ends where the phone said, and segments are never joined.
 *
 * The input is never changed: a new array comes back, with the time and the
 * accuracy of each vertex as they were.
 */

export const SMOOTH_DEFAULTS = {
  halfWindow: 2,
  windowMs: 10 * 60_000,
  /** 250 km/h: above that a window is travel, not jitter. */
  gateMps: 70,
} as const;

export type SmoothOptions = { halfWindow: number; windowMs: number; gateMps: number };

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function windowOf(segment: readonly StoredPoint[], i: number, o: SmoothOptions): StoredPoint[] {
  // Centred: as many neighbours on each side, so a vertex near an end is not
  // pulled towards the side that happens to have more of them.
  const h = Math.min(o.halfWindow, i, segment.length - 1 - i);
  const t = segment[i][0];
  return segment.slice(i - h, i + h + 1).filter((q) => Math.abs(q[0] - t) <= o.windowMs);
}

/** Whether the window moves faster end to end than the gate allows. */
function isTravel(window: readonly StoredPoint[], gateMps: number): boolean {
  const a = window[0];
  const b = window[window.length - 1];
  const seconds = Math.abs(b[0] - a[0]) / 1000;
  if (seconds === 0) return false;
  return (
    (haversineKm({ lat: a[1], lon: a[2] }, { lat: b[1], lon: b[2] }) * 1000) / seconds > gateMps
  );
}

export function smoothSegment(
  segment: readonly StoredPoint[],
  options: SmoothOptions = SMOOTH_DEFAULTS
): StoredPoint[] {
  return segment.map((p, i) => {
    if (i === 0 || i === segment.length - 1) return [...p] as StoredPoint;
    const window = windowOf(segment, i, options);
    if (window.length < 3 || isTravel(window, options.gateMps)) return [...p] as StoredPoint;
    return [p[0], median(window.map((w) => w[1])), median(window.map((w) => w[2])), p[3]];
  });
}

export function smoothSegments(
  segments: readonly (readonly StoredPoint[])[],
  options: SmoothOptions = SMOOTH_DEFAULTS
): StoredPoint[][] {
  return segments.map((s) => smoothSegment(s, options));
}
