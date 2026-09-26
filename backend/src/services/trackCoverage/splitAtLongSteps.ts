import { haversineKm } from "../../shared/geo/haversine";
import type { ParsedTrack } from "../tour/tracks/parseGpx";

/**
 * How many times the recording's own typical step a single step must be
 * before it counts as a hole in a SPARSE recording. Three: a thinned export
 * or a phone logging once an hour varies its step with the ship's speed by
 * well under that, and a signal loss of a few hours is many times it.
 */
export const SPARSE_HOLE_FACTOR = 3;

function stepKm(a: [number, number], b: [number, number]): number {
  return haversineKm({ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The step length above which this recording has a hole: `floorKm`, or
 * `SPARSE_HOLE_FACTOR` times the recording's median step, whichever is longer.
 *
 * A fixed limit alone assumed one point a minute. A GPX of 41 points across
 * ~900 km (one every ~22 km) stepped over the 20 km limit at EVERY point, so
 * the whole file became holes, the raw distance summed to 0 km and no leg was
 * covered (browser acceptance 2026-09-26). A hole is a step unlike the
 * recording's own sampling, not a step longer than someone else's.
 */
export function holeThresholdKm(parsed: ParsedTrack, floorKm: number): number {
  const boundaries = new Set(parsed.segmentStarts);
  const steps: number[] = [];
  for (let i = 1; i < parsed.points.length; i++) {
    if (!boundaries.has(i)) steps.push(stepKm(parsed.points[i - 1], parsed.points[i]));
  }
  return Math.max(floorKm, SPARSE_HOLE_FACTOR * median(steps));
}

/**
 * Marks every step longer than the recording's hole threshold (see
 * `holeThresholdKm`) between two consecutive raw points as the start of a new
 * recording segment.
 *
 * A file draws its own breaks (`<trkseg>`, a TCX `<Track>`), but a phone that
 * loses signal at sea draws none: Dawarich hands back one time-ordered list,
 * and a GPX export from a phone app is often a single segment with a hundred
 * kilometres between two of its points. Unmarked, that jump is a straight
 * line presented as a recording. Marked, it becomes a hole the coverage rule
 * can see and weigh (`legCoverage.ts`), and the raw running distance stops at
 * it like at any other boundary.
 *
 * Pure; the input is not changed. Existing boundaries are kept.
 */
export function splitAtLongSteps(parsed: ParsedTrack, minHoleKm: number): ParsedTrack {
  const limit = holeThresholdKm(parsed, minHoleKm);
  const starts = new Set<number>(parsed.segmentStarts.length > 0 ? parsed.segmentStarts : [0]);
  starts.add(0);
  for (let i = 1; i < parsed.points.length; i++) {
    if (stepKm(parsed.points[i - 1], parsed.points[i]) > limit) starts.add(i);
  }
  return { ...parsed, segmentStarts: [...starts].sort((a, b) => a - b) };
}
