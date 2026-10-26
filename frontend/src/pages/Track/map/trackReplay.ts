import type { TrackPoint } from "../../../lib/api/travtrack";
import { lonLat, type LonLat } from "./trackGeometry";

/**
 * Replay of the shown day(s) (TravTrack plan T5.2). Time runs through the
 * recorded stretches only: when a stretch ends, the clock jumps to the start
 * of the next one — a gap is skipped, never played as a line that was not
 * there. A position is interpolated between two neighbouring fixes of ONE
 * stretch, never across a break.
 */

export interface ReplaySpan {
  fromMs: number;
  untilMs: number;
}

/** Track milliseconds per wall-clock millisecond: 1x plays a recorded minute per second. */
export const REPLAY_RATES = { "1x": 60, "4x": 240, "16x": 960 } as const;
export type ReplayRate = keyof typeof REPLAY_RATES;

/** The stretches' time spans in order, overlapping ones merged (two devices, one hour). */
export function replaySpans(segments: readonly TrackPoint[][]): ReplaySpan[] {
  const spans = segments
    .filter((s) => s.length > 0)
    .map((s) => ({ fromMs: s[0][0], untilMs: s[s.length - 1][0] }))
    .sort((a, b) => a.fromMs - b.fromMs);
  return spans.reduce<ReplaySpan[]>((out, span) => {
    const last = out[out.length - 1];
    if (last && span.fromMs <= last.untilMs) {
      return [...out.slice(0, -1), { ...last, untilMs: Math.max(last.untilMs, span.untilMs) }];
    }
    return [...out, span];
  }, []);
}

/** A moment inside a span stays; one in a gap moves to the next span's start. */
export function snapToSpan(spans: readonly ReplaySpan[], t: number): number {
  const first = spans[0];
  if (!first) return t;
  if (t <= first.fromMs) return first.fromMs;
  for (const span of spans) {
    if (t <= span.untilMs) return Math.max(t, span.fromMs);
  }
  return spans[spans.length - 1].untilMs;
}

/**
 * The clock after `dt` track-milliseconds. Running past a span's end lands on
 * the next span's start (the rest of the step is dropped, so no span is ever
 * passed over); past the last span the replay is done.
 */
export function advanceReplay(
  spans: readonly ReplaySpan[],
  t: number,
  dt: number
): { t: number; done: boolean } {
  const last = spans[spans.length - 1];
  if (!last) return { t, done: true };
  const index = spans.findIndex((s) => t <= s.untilMs);
  if (index === -1) return { t: last.untilMs, done: true };
  const span = spans[index];
  const current = Math.max(t, span.fromMs);
  const next = current + dt;
  if (next <= span.untilMs) return { t: next, done: false };
  const following = spans[index + 1];
  if (following) return { t: following.fromMs, done: false };
  return { t: last.untilMs, done: true };
}

/** Where each stretch stands at `t`; a stretch that does not cover `t` has no position. */
export function replayPositions(segments: readonly TrackPoint[][], t: number): LonLat[] {
  return segments.flatMap((segment) => {
    const first = segment[0];
    const last = segment[segment.length - 1];
    if (!first || !last || t < first[0] || t > last[0]) return [];
    const i = segment.findIndex((p) => p[0] >= t);
    const b = segment[i];
    const a = segment[i - 1];
    if (!a || b[0] === t || b[0] === a[0]) return [lonLat(b)];
    const f = (t - a[0]) / (b[0] - a[0]);
    return [[a[2] + (b[2] - a[2]) * f, a[1] + (b[1] - a[1]) * f] as LonLat];
  });
}

/**
 * The stretches as far as the replay has come: whole stretches before `t`,
 * the running one cut at `t` (its head interpolated inside that stretch),
 * nothing of a stretch that starts later.
 */
export function clipSegments(segments: readonly TrackPoint[][], t: number): TrackPoint[][] {
  return segments.flatMap((segment) => {
    const done = segment.filter((p) => p[0] <= t);
    const lastDone = done[done.length - 1];
    if (!lastDone) return [];
    const head = replayPositions([segment], t)[0];
    const line: TrackPoint[] =
      head && lastDone[0] < t ? [...done, [t, head[1], head[0], null]] : done;
    return [line];
  });
}
