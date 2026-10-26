import type { TrackPoint } from "../../../lib/api/travtrack";
import type { TravTrackRange } from "../../../lib/api/travtrackViews";
import { distanceM } from "../../../pages/Track/map/trackGeometry";

/**
 * The stretch of history an inbox question stands on (owner, 2026-10-26: "die
 * Vorschläge sollten bei der Frage den Tracking Abschnitt zeigen"), and what
 * can be said about it. Works on the server's privacy-safe stretches only and,
 * like the Track map, never joins two: a clip cuts a stretch, a sum runs
 * inside one stretch, and the step from one stretch to the next — a privacy
 * zone, a deletion, a pause — counts as nothing at all.
 */

export interface SectionWindow {
  fromMs: number;
  untilMs: number;
}

/** Every stretch of every part, cut to `[fromMs, untilMs)`; empty pieces are dropped. */
export function clipStretches(
  parts: readonly Pick<TravTrackRange, "segments">[],
  window: SectionWindow
): TrackPoint[][] {
  const out: TrackPoint[][] = [];
  for (const part of parts) {
    for (const stretch of part.segments) {
      const inside = stretch.filter((p) => p[0] >= window.fromMs && p[0] < window.untilMs);
      if (inside.length > 0) out.push(inside);
    }
  }
  return out;
}

export interface SectionFacts {
  /** Metres along the stretches; null with fewer than two fixes in any stretch. */
  distanceM: number | null;
  /** km/h over the time inside stretches; null where no time passed inside one. */
  avgKmh: number | null;
  /** The fastest step between two neighbouring fixes; null as above. */
  maxKmh: number | null;
  points: number;
  firstMs: number | null;
  lastMs: number | null;
  /** Breaks inside the section: stretches beyond the first. */
  cuts: number;
}

/** A step faster than this is a position jump, not travel (an airliner tops out near 1000). */
const IMPLAUSIBLE_KMH = 1_200;

export function sectionFacts(stretches: readonly TrackPoint[][]): SectionFacts {
  let metres = 0;
  let timeMs = 0;
  let steps = 0;
  let maxKmh: number | null = null;
  let points = 0;
  let firstMs: number | null = null;
  let lastMs: number | null = null;
  for (const stretch of stretches) {
    points += stretch.length;
    for (const p of stretch) {
      if (firstMs === null || p[0] < firstMs) firstMs = p[0];
      if (lastMs === null || p[0] > lastMs) lastMs = p[0];
    }
    for (let i = 1; i < stretch.length; i++) {
      const d = distanceM(stretch[i - 1], stretch[i]);
      const dt = stretch[i][0] - stretch[i - 1][0];
      metres += d;
      steps += 1;
      if (dt > 0) {
        timeMs += dt;
        const kmh = (d / dt) * 3_600;
        if (kmh < IMPLAUSIBLE_KMH && (maxKmh === null || kmh > maxKmh)) maxKmh = kmh;
      }
    }
  }
  return {
    distanceM: steps > 0 ? metres : null,
    avgKmh: timeMs > 0 ? (metres / timeMs) * 3_600 : null,
    maxKmh,
    points,
    firstMs,
    lastMs,
    cuts: Math.max(0, stretches.length - 1),
  };
}

/**
 * The marked share of one local day, as two percentages of 24 h, or null when
 * the window does not lie within one local day. `fromMinute`/`untilMinute` are
 * minutes since local midnight; an end at midnight is the day's end.
 */
export function dayBarOf(
  fromMinute: number,
  untilMinute: number
): { left: number; width: number } | null {
  if (untilMinute <= fromMinute) return null;
  const left = (fromMinute / 1_440) * 100;
  return { left, width: Math.max(0.5, ((untilMinute - fromMinute) / 1_440) * 100) };
}
