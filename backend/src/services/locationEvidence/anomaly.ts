/**
 * Anomalies of a position history (TravTrack plan E2, spec §10 point 1): the
 * same thresholds the other location provider applies, judged per device.
 *
 *   - an accuracy worse than 10 km, or a fix at null island, is masked;
 *   - a JUMP is a step between two consecutive fixes of one device that
 *     covers more than 1 km within the same second, or runs faster than
 *     `max(1000 km/h, 3 × the device's median speed)`;
 *   - a run of at most five fixes between two jumps is masked — the phone
 *     handed over a stale or wrong fix and came back. Six or more are a real
 *     move, and a single jump with no return is left alone: which side of it
 *     is wrong cannot be told.
 *
 * Masked, never deleted: the mask is a verdict on this read, the stored
 * points stay as they are.
 */
import { haversineKm } from "../../shared/geo/haversine";
import type { LocationObservation } from "../locationProvider/types";

export const MAX_ACCURACY_M = 10_000;
export const SAME_SECOND_JUMP_KM = 1;
export const MIN_JUMP_SPEED_KMH = 1000;
export const MEDIAN_SPEED_FACTOR = 3;
export const MAX_MASKED_RUN = 5;

/** Within ~11 m of 0°, 0°: the fix a phone reports when it has none. */
const NULL_ISLAND_DEG = 0.0001;

const MS_PER_HOUR = 3_600_000;

type Fix = Pick<LocationObservation, "atMs" | "lat" | "lon" | "accuracyM">;

const isNullIsland = (p: Fix) =>
  Math.abs(p.lat) < NULL_ISLAND_DEG && Math.abs(p.lon) < NULL_ISLAND_DEG;

const isBadFix = (p: Fix) =>
  (p.accuracyM !== null && p.accuracyM > MAX_ACCURACY_M) || isNullIsland(p);

/**
 * Speed of a step in km/h, measured over at least one second: two fixes a
 * fraction of a second apart would otherwise turn GPS jitter into a jet.
 */
function stepSpeedKmh(a: Fix, b: Fix): number {
  const hours = Math.max(1000, b.atMs - a.atMs) / MS_PER_HOUR;
  return haversineKm(a, b) / hours;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Indices into `fixes` where a jump lands (the step from `i - 1` to `i`). */
function jumpIndices(fixes: readonly Fix[]): number[] {
  const speeds = fixes.slice(1).map((p, i) => stepSpeedKmh(fixes[i], p));
  const limit = Math.max(MIN_JUMP_SPEED_KMH, MEDIAN_SPEED_FACTOR * median(speeds));
  const jumps: number[] = [];
  for (let i = 1; i < fixes.length; i += 1) {
    const a = fixes[i - 1];
    const b = fixes[i];
    const sameSecond = Math.floor(a.atMs / 1000) === Math.floor(b.atMs / 1000);
    if ((sameSecond && haversineKm(a, b) > SAME_SECOND_JUMP_KM) || speeds[i - 1] > limit) {
      jumps.push(i);
    }
  }
  return jumps;
}

/** One device's verdicts, `fixes` in time order. */
function deviceMask(fixes: readonly Fix[]): boolean[] {
  const mask = fixes.map(isBadFix);
  const kept = fixes.map((_, i) => i).filter((i) => !mask[i]);
  const jumps = jumpIndices(kept.map((i) => fixes[i]));
  for (let k = 0; k + 1 < jumps.length;) {
    const [from, to] = [jumps[k], jumps[k + 1]];
    if (to - from <= MAX_MASKED_RUN) {
      for (let j = from; j < to; j += 1) mask[kept[j]] = true;
      k += 2;
    } else {
      k += 1;
    }
  }
  return mask;
}

/**
 * Which of these time-ordered observations are anomalies — `true` at the
 * index of each masked one, in the input's order. Devices are judged apart:
 * two phones far from each other are two histories, not a jump.
 */
export function anomalyMask(points: readonly LocationObservation[]): boolean[] {
  const byDevice = new Map<string | null, number[]>();
  points.forEach((p, i) => {
    const list = byDevice.get(p.deviceId) ?? [];
    list.push(i);
    byDevice.set(p.deviceId, list);
  });
  const mask = new Array<boolean>(points.length).fill(false);
  for (const indices of byDevice.values()) {
    const verdicts = deviceMask(indices.map((i) => points[i]));
    indices.forEach((i, j) => {
      mask[i] = verdicts[j];
    });
  }
  return mask;
}
