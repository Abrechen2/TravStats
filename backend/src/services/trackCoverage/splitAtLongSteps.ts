import { haversineKm } from "../../shared/geo/haversine";
import type { ParsedTrack } from "../tour/tracks/parseGpx";

/**
 * Marks every step longer than `maxStepKm` between two consecutive raw points
 * as the start of a new recording segment.
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
export function splitAtLongSteps(parsed: ParsedTrack, maxStepKm: number): ParsedTrack {
  const starts = new Set<number>(parsed.segmentStarts.length > 0 ? parsed.segmentStarts : [0]);
  starts.add(0);
  for (let i = 1; i < parsed.points.length; i++) {
    const [lonA, latA] = parsed.points[i - 1];
    const [lonB, latB] = parsed.points[i];
    if (haversineKm({ lat: latA, lon: lonA }, { lat: latB, lon: lonB }) > maxStepKm) starts.add(i);
  }
  return { ...parsed, segmentStarts: [...starts].sort((a, b) => a - b) };
}
