import { polylineDistanceKm } from "../../cruiseDistance/polylineDistance";

/**
 * The figures a day tour is read by — climb, descent, time in motion — taken
 * from the RAW points of a recording, before simplification.
 *
 * Why raw: Douglas-Peucker keeps the points that bend the line on the map. A
 * switchback climb of 12 m is invisible in plan view, so the simplified line
 * drops it, and a hike measured afterwards comes out flatter than it was.
 *
 * Why a hysteresis band instead of summing every positive step: barometric
 * and GPS elevation both jitter by a few metres. Summed naively, ±2 m of noise
 * on a flat promenade adds up to hundreds of metres of "climb". A change
 * counts only once it has moved further than `BAND_M` from the last accepted
 * reading — the approach most watch and app vendors describe for their totals.
 */

/** Metres an elevation must move before it counts as climb or descent. */
const BAND_M = 5;

/**
 * Speed above which an interval counts as moving (m/s). 0.5 m/s is well under
 * a slow hiking pace (~1 m/s) and over the drift a phone reports standing still.
 */
const MOVING_MIN_MPS = 0.5;

/**
 * Longest interval that still counts. A longer one is a pause the recorder
 * did not mark as a new segment (auto-pause on some watches), not ten
 * minutes of walking at an average speed.
 */
const MOVING_MAX_INTERVAL_S = 300;

/** Index ranges `[start, end)` of each recording segment. */
function segments(
  total: number,
  segmentStarts: readonly number[] | undefined
): Array<[number, number]> {
  const starts = [...new Set((segmentStarts ?? []).filter((i) => i >= 0 && i < total))].sort(
    (a, b) => a - b
  );
  if (starts[0] !== 0) starts.unshift(0);
  return starts
    .map((s, i): [number, number] => [s, i + 1 < starts.length ? starts[i + 1] : total])
    .filter(([s, e]) => e > s);
}

export interface ClimbAndDescent {
  ascentM: number;
  descentM: number;
}

/**
 * Climb and descent in whole metres, or `null` when the recording carries
 * fewer than two elevation readings — abstention, never zero: a track with
 * no elevation is not a flat track.
 *
 * Peak-and-valley hysteresis: a turn from climbing to descending (or back)
 * is only accepted once the reading has moved `BAND_M` past the running
 * extreme, and the leg is then committed from the last confirmed extreme to
 * that peak or valley. A plain "count a step once it exceeds the band" loses
 * the tail of every climb that ends inside the band — a 12 m bump measured 8.
 */
export function climbAndDescent(
  elevations: ReadonlyArray<number | null>,
  segmentStarts?: readonly number[]
): ClimbAndDescent | null {
  let readings = 0;
  let ascent = 0;
  let descent = 0;

  const commit = (from: number, to: number): void => {
    if (to > from) ascent += to - from;
    else descent += from - to;
  };

  for (const [start, end] of segments(elevations.length, segmentStarts)) {
    // Everything resets per segment: the height between two recordings was
    // never climbed on foot.
    let reference: number | null = null;
    let direction: 1 | -1 | 0 = 0;
    let extreme = 0;
    let high = 0;
    let low = 0;

    for (let i = start; i < end; i++) {
      const value = elevations[i];
      if (value === null || !Number.isFinite(value)) continue;
      readings++;
      if (reference === null) {
        reference = high = low = value;
        continue;
      }
      if (direction === 0) {
        high = Math.max(high, value);
        low = Math.min(low, value);
        if (high - reference > BAND_M) {
          direction = 1;
          extreme = high;
        } else if (reference - low > BAND_M) {
          direction = -1;
          extreme = low;
        }
        continue;
      }
      if (direction === 1) {
        if (value > extreme) extreme = value;
        else if (extreme - value > BAND_M) {
          commit(reference, extreme);
          reference = extreme;
          direction = -1;
          extreme = value;
        }
      } else {
        if (value < extreme) extreme = value;
        else if (value - extreme > BAND_M) {
          commit(reference, extreme);
          reference = extreme;
          direction = 1;
          extreme = value;
        }
      }
    }
    if (reference !== null && direction !== 0) commit(reference, extreme);
  }

  if (readings < 2) return null;
  return { ascentM: Math.round(ascent), descentM: Math.round(descent) };
}

/**
 * Seconds spent moving, or `null` when fewer than two points carry a time.
 * `times` holds epoch milliseconds per point, aligned with `points`.
 */
export function movingSeconds(
  points: ReadonlyArray<[number, number]>,
  times: ReadonlyArray<number | null> | undefined,
  segmentStarts?: readonly number[]
): number | null {
  if (!times || times.length !== points.length) return null;
  if (times.filter((t) => t !== null).length < 2) return null;

  let total = 0;
  for (const [start, end] of segments(points.length, segmentStarts)) {
    let previous: number | null = null;
    for (let i = start; i < end; i++) {
      const t = times[i];
      if (t === null) continue;
      if (previous !== null) {
        const seconds = (t - (times[previous] as number)) / 1000;
        if (seconds > 0 && seconds <= MOVING_MAX_INTERVAL_S) {
          const metres = polylineDistanceKm([points[previous], points[i]]) * 1000;
          if (metres / seconds >= MOVING_MIN_MPS) total += seconds;
        }
      }
      previous = i;
    }
  }
  return Math.round(total);
}
