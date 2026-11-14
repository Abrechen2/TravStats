import { withoutBadVertices } from "./drawnFixes";
import { STAY_CONTEXT_MS, travTrackLegs, type Leg, type Stop } from "./legs";
import { readSafeTravTrack, type SafeSpan, type Span } from "./readSafe";

/**
 * The ONE derivation of a profile day's legs and stops: the day view reads it, and
 * so do the stop writes (`stopPlaces/`), which must find exactly the stops the day
 * showed. A second copy that differed in its window is what made a night across
 * midnight unnameable (rc.31: the view derived from the day +-24 h, the writes from
 * the day alone).
 */

export const DAY_POINT_CAP = 50_000;

export type DerivedDay = {
  window: Span;
  /** The day's own read, before bad fixes are dropped (`next` says it was cut short). */
  raw: SafeSpan;
  /** The day's own read without bad fixes: what is drawn. */
  read: SafeSpan;
  legs: Leg[];
  /** The stops that touch the day, clipped to it and flagged where a stay goes on past an edge. */
  stops: Stop[];
  /** The stays behind `stops`, unclipped, in the order the points make them. */
  whole: Stop[];
};

export async function deriveDay(userId: string, window: Span): Promise<DerivedDay> {
  const [raw, wide] = await Promise.all([
    readSafeTravTrack(userId, window, DAY_POINT_CAP),
    // The evidence a stay across midnight rests on; a read cut short by its cap is not used.
    readSafeTravTrack(
      userId,
      { fromMs: window.fromMs - STAY_CONTEXT_MS, untilMs: window.untilMs + STAY_CONTEXT_MS },
      DAY_POINT_CAP * 3
    ),
  ]);
  // Bad fixes are not drawn, nor do they shape legs and stops (`drawnFixes.ts`).
  const read = withoutBadVertices(raw);
  const context = wide.next === null ? withoutBadVertices(wide) : undefined;
  const derived = await travTrackLegs(userId, window, read, context, Date.now());
  return { window, raw, read, ...derived };
}
