import { haversineKm } from "../../../shared/geo/haversine";
import type { SourcePoint } from "./types";

/**
 * A constant clock offset between two sources on an overlapping day — the
 * signature of an export written in local time and read as UTC: both record
 * the same path, one of them shifted by whole quarter hours. Detected and
 * REPORTED; nothing is ever shifted (owner design point 6).
 *
 * Compared in UTC instants. Needs movement: standing still matches at every
 * offset, so a day without a few kilometres of travel says nothing.
 */

const STEP_S = 15 * 60;
const MAX_OFFSET_S = 14 * 3600;
const MAX_SAMPLES = 200;
const MIN_SAMPLES = 10;
/** A partner fix further than this from the shifted instant is no partner. */
const PAIR_WINDOW_MS = 10 * 60_000;
const MIN_TRAVEL_KM = 5;
const ALIGNED_KM = 1;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** The nearest-in-time fix of `pts` (time-ordered) to `tMs`, within the pair window. */
function nearest(pts: readonly SourcePoint[], tMs: number): SourcePoint | null {
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].tMs < tMs) lo = mid + 1;
    else hi = mid;
  }
  const near = [pts[lo - 1], pts[lo]]
    .filter((p): p is SourcePoint => p !== undefined)
    .sort((a, b) => Math.abs(a.tMs - tMs) - Math.abs(b.tMs - tMs))[0];
  return near && Math.abs(near.tMs - tMs) <= PAIR_WINDOW_MS ? near : null;
}

/** Median distance between `a`'s fixes and `b` read `offsetS` later, or null with too few pairs. */
function misfitKm(a: readonly SourcePoint[], b: readonly SourcePoint[], offsetS: number) {
  const d: number[] = [];
  for (const p of a) {
    const q = nearest(b, p.tMs + offsetS * 1000);
    if (q) d.push(haversineKm(p, q));
  }
  return d.length >= MIN_SAMPLES ? median(d) : null;
}

/**
 * The offset in seconds by which `b`'s clock runs ahead of `a`'s (b's fix of
 * a place is stamped `offsetS` later), or null when none is seen. Both
 * time-ordered.
 */
export function detectClockOffset(
  a: readonly SourcePoint[],
  b: readonly SourcePoint[]
): number | null {
  if (a.length < MIN_SAMPLES || b.length < MIN_SAMPLES) return null;
  const travel = Math.max(...a.map((p) => haversineKm(a[0], p)));
  if (travel < MIN_TRAVEL_KM) return null;
  const stride = Math.max(1, Math.floor(a.length / MAX_SAMPLES));
  const sample = a.filter((_, i) => i % stride === 0);
  let best: { offsetS: number; km: number } | null = null;
  for (let off = -MAX_OFFSET_S; off <= MAX_OFFSET_S; off += STEP_S) {
    const km = misfitKm(sample, b, off);
    if (km !== null && (!best || km < best.km)) best = { offsetS: off, km };
  }
  if (!best || best.offsetS === 0 || best.km > ALIGNED_KM) return null;
  const atZero = misfitKm(sample, b, 0);
  // No pairs at all without a shift, or clearly worse: the shift is what aligns them.
  return atZero === null || atZero > Math.max(2 * ALIGNED_KM, 3 * best.km) ? best.offsetS : null;
}
