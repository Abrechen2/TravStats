import type { StoredPoint } from "../../tripRecording/segments";
import { LOW_SCORE, type DaySourceSummary } from "../bestSource/choices";
import { privacyCut } from "../privacyCut";
import type { SafeSpan, Span } from "../readSafe";
import { smoothSegment } from "./smooth";
import { matchesIn, smoothingChoice } from "./store";

/**
 * The day view's cleanup part (rc46 extras C), additive on the wire: a client
 * that never heard of it draws the day as before.
 *
 * - `smoothing.eligible` — a source the day draws from scores below
 *   `LOW_SCORE` (a sparse or noisy Google import, typically). Only such a
 *   source's stretches are ever smoothed.
 * - `smoothed` — those stretches through the speed-gated median, for drawing
 *   and labelled "geglättet"; null while smoothing is off or nothing is
 *   eligible. `segments` stay the raw read, untouched.
 * - `matched` — stretches matched to roads, privacy-cut again on the way out
 *   (a road line may pass a zone the recorded fixes never entered), each with
 *   its id for the undo.
 */

export type DayCleanup = {
  smoothing: {
    eligible: boolean;
    on: boolean;
    /** Where `on` comes from: this day's own choice, or the account's default. */
    from: "day" | "global";
    global: boolean;
    threshold: number;
  };
  smoothed: StoredPoint[][] | null;
  matched: Array<{
    id: string;
    fromMs: number;
    untilMs: number;
    lines: [number, number][][];
    confidence: number;
    provider: string;
  }>;
};

/** The origins of the day whose score lies below the threshold. */
export function lowSources(sources: Pick<DaySourceSummary, "sources">): Set<string> {
  return new Set(sources.sources.filter((s) => s.score < LOW_SCORE).map((s) => s.source));
}

/**
 * The drawn stretches, smoothed where their source is low-scoring and left
 * exactly as read everywhere else. A new array; the read is not changed.
 */
export function smoothedSegments(
  read: Pick<SafeSpan, "segments" | "rowOf">,
  low: ReadonlySet<string>
): StoredPoint[][] {
  return read.segments.map((segment) => {
    const origin = segment.length > 0 ? read.rowOf(segment[0])?.origin : undefined;
    return origin !== undefined && low.has(origin)
      ? smoothSegment(segment)
      : segment.map((p) => [...p] as StoredPoint);
  });
}

export async function dayCleanup(
  userId: string,
  window: Span,
  read: SafeSpan,
  sources: Pick<DaySourceSummary, "sources">
): Promise<DayCleanup> {
  const [choice, matches] = await Promise.all([
    smoothingChoice(userId, window),
    matchesIn(userId, window),
  ]);
  const low = lowSources(sources);
  const eligible = low.size > 0;
  const on = choice.span ?? choice.global;
  return {
    smoothing: {
      eligible,
      on,
      from: choice.span === null ? "global" : "day",
      global: choice.global,
      threshold: LOW_SCORE,
    },
    smoothed: on && eligible ? smoothedSegments(read, low) : null,
    // Fail closed: a match over a deleted span is not drawn, even if a removal missed its row.
    matched: matches
      .filter((m) => !read.deleted.some((d) => d.fromMs < m.untilMs && d.untilMs > m.fromMs))
      .map((m) => ({
        id: m.id,
        fromMs: m.fromMs,
        untilMs: m.untilMs,
        lines: privacyCut(m.lines, read.circles),
        confidence: m.confidence,
        provider: m.provider,
      })),
  };
}
