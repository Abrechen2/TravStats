/**
 * The figures of TravTrack's monthly values (TravTrack plan L3, spec §10
 * point 5), read from the privacy-safe stretches only (`readSafe.ts`): what a
 * zone hides is gone before anything is counted, and a stretch is never
 * joined across a zone, a deleted span, a pause or a gap.
 *
 *   - Ground kilometres: the steps between consecutive vertices of a stretch,
 *     except a step in the air (either end inside one of the account's flight
 *     windows, or a point recorded for a flight), a step faster than
 *     500 km/h (a train is slower, a teleport or an unmarked flight is not),
 *     and a step touching a bad fix (`isBadFix`).
 *   - The UTC days the vertices fall on.
 *
 * Pure: no database, no clock.
 */
import { haversineKm } from "../../../shared/geo/haversine";
import type { FlightWindow } from "../../locationEvidence/anomaly";
import { isBadFix } from "../../locationEvidence/anomaly";
import type { StoredPoint } from "../../tripRecording/segments";
import { utcDayOf } from "../dirtyDays";

/** Faster than this a step is no ground travel (spec §10 point 5). */
export const MAX_GROUND_KMH = 500;

/** Whether a vertex was recorded in the air. */
export type InFlight = (point: StoredPoint) => boolean;

/** In the air: inside one of these windows (inclusive) or flagged so by `flagged`. */
export function inFlightBy(
  windows: readonly FlightWindow[],
  flagged: (point: StoredPoint) => boolean = () => false
): InFlight {
  return (p) => flagged(p) || windows.some(([from, to]) => p[0] >= from && p[0] <= to);
}

const fix = (p: StoredPoint) => ({ atMs: p[0], lat: p[1], lon: p[2], accuracyM: p[3] });

/** Ground kilometres of these stretches; a step in the air, too fast or from a bad fix adds nothing. */
export function groundKm(stretches: readonly StoredPoint[][], inFlight: InFlight): number {
  let km = 0;
  for (const stretch of stretches) {
    for (let i = 1; i < stretch.length; i++) {
      const a = stretch[i - 1];
      const b = stretch[i];
      const hours = (b[0] - a[0]) / 3_600_000;
      if (hours <= 0) continue;
      if (inFlight(a) || inFlight(b) || isBadFix(fix(a)) || isBadFix(fix(b))) continue;
      const step = haversineKm(fix(a), fix(b));
      if (step / hours > MAX_GROUND_KMH) continue;
      km += step;
    }
  }
  return km;
}

/** The distinct UTC days the stretches' vertices fall on. */
export function vertexDays(stretches: readonly StoredPoint[][]): Set<string> {
  const days = new Set<string>();
  for (const stretch of stretches) for (const p of stretch) days.add(utcDayOf(p[0]));
  return days;
}

/** The UTC days of `[fromMs, untilMs)` a span touches, clipped to the month. */
export function spanDays(
  span: { fromMs: number; untilMs: number },
  month: { fromMs: number; untilMs: number }
): string[] {
  const from = Math.max(span.fromMs, month.fromMs);
  const until = Math.min(span.untilMs, month.untilMs);
  const out: string[] = [];
  for (let ms = from; ms < until; ms = Date.parse(`${utcDayOf(ms)}T00:00:00.000Z`) + 86_400_000) {
    out.push(utcDayOf(ms));
  }
  return out;
}
