import type { TravTrackDay } from "../../../lib/api/travtrack";
import type { TravTrackLeg } from "../../../lib/api/travtrackLegs";
import type { TravTrackRange } from "../../../lib/api/travtrackViews";
import { lonLat, type LonLat, type RangeTotals } from "./trackGeometry";

/**
 * Legs on the Track map (spec 2026-11-03-travtrack-legs, W1): what a leg
 * draws, and the range totals taken from the server's aggregates. A leg's
 * ranges index the day's `segments` vertex by vertex, so its line is cut from
 * exactly the stretches the map already draws — never joined across two.
 */

/** What the map and the aside have selected: one leg, or one stop, of one day. */
export type TrackSelection =
  { kind: "leg"; date: string; id: string } | { kind: "stop"; date: string; fromMs: number };

/** The leg's own stretches, as lines (a single vertex draws nothing). */
export function legLines(day: Pick<TravTrackDay, "segments">, leg: TravTrackLeg): LonLat[][] {
  return leg.ranges.flatMap((range) => {
    const segment = day.segments[range.segment];
    if (!segment) return [];
    const line = segment.slice(range.from, range.to + 1).map(lonLat);
    return line.length > 1 ? [line] : [];
  });
}

/** The leg's frame as lines, for the map's fit when the leg has no drawable stretch. */
export function legFrame(day: Pick<TravTrackDay, "segments">, leg: TravTrackLeg): LonLat[][] {
  const lines = legLines(day, leg);
  if (lines.length > 0) return lines;
  const [west, south, east, north] = leg.bounds;
  return [
    [
      [west, south],
      [east, north],
    ],
  ];
}

const MPS_TO_KMH = 3.6;

/**
 * The range totals from the server's aggregates, which come from the stored
 * points and not from the simplified drawing. Used only when EVERY part
 * carries them: one part from an older server would understate the sum, and a
 * mixed figure is worse than the geometry's honest one. A moving time any part
 * could not tell stays unknown for the whole.
 */
export function totalsFromAggregates(
  base: RangeTotals,
  parts: readonly TravTrackRange[]
): RangeTotals {
  if (parts.length === 0 || parts.some((p) => !p.aggregates)) return base;
  const all = parts.map((p) => p.aggregates!);
  const distanceM = all.reduce((n, a) => n + a.distanceM, 0);
  const movingMs = all.some((a) => a.movingMs === null)
    ? null
    : all.reduce((n, a) => n + (a.movingMs ?? 0), 0);
  const speeds = all.flatMap((a) => (a.maxSpeedMps === null ? [] : [a.maxSpeedMps]));
  return {
    ...base,
    distanceM,
    movingMs,
    avgKmh: movingMs !== null && movingMs > 0 ? (distanceM / movingMs) * 1000 * MPS_TO_KMH : null,
    maxKmh: speeds.length > 0 ? Math.max(...speeds) * MPS_TO_KMH : null,
  };
}
