import { describe, expect, it } from "vitest";
import type { TrackPoint } from "../../../../lib/api/travtrack";
import {
  advanceReplay,
  clipSegments,
  replayPositions,
  replaySpans,
  snapToSpan,
} from "../trackReplay";

/**
 * Replay (plan T5.2): time runs through recorded stretches only, jumps every
 * gap, and never interpolates between two stretches.
 */

const MIN = 60_000;
const p = (min: number, lat: number, lon: number): TrackPoint => [min * MIN, lat, lon, 5];
const A = [p(0, 10, 10), p(10, 10, 11)];
const B = [p(60, 20, 20), p(70, 20, 21)];

describe("replay", () => {
  const spans = replaySpans([B, A]);

  it("orders and merges the spans", () => {
    expect(spans).toEqual([
      { fromMs: 0, untilMs: 10 * MIN },
      { fromMs: 60 * MIN, untilMs: 70 * MIN },
    ]);
    expect(replaySpans([A, [p(5, 1, 1), p(20, 1, 1)]])).toEqual([{ fromMs: 0, untilMs: 20 * MIN }]);
  });

  it("jumps over the gap to the next stretch's start", () => {
    expect(advanceReplay(spans, 5 * MIN, 2 * MIN)).toEqual({ t: 7 * MIN, done: false });
    expect(advanceReplay(spans, 9 * MIN, 30 * MIN)).toEqual({ t: 60 * MIN, done: false });
    expect(advanceReplay(spans, 69 * MIN, 5 * MIN)).toEqual({ t: 70 * MIN, done: true });
  });

  it("a scrub into the gap snaps to the next stretch", () => {
    expect(snapToSpan(spans, 30 * MIN)).toBe(60 * MIN);
    expect(snapToSpan(spans, 5 * MIN)).toBe(5 * MIN);
    expect(snapToSpan(spans, -5)).toBe(0);
    expect(snapToSpan(spans, 999 * MIN)).toBe(70 * MIN);
  });

  it("never stands between two stretches", () => {
    expect(replayPositions([A, B], 30 * MIN)).toEqual([]);
    const [mid] = replayPositions([A, B], 5 * MIN);
    expect(mid).toEqual([10.5, 10]);
  });

  it("the trail is cut at the clock and never joins two stretches", () => {
    expect(clipSegments([A, B], 5 * MIN)).toEqual([[p(0, 10, 10), [5 * MIN, 10, 10.5, null]]]);
    const later = clipSegments([A, B], 65 * MIN);
    expect(later).toHaveLength(2);
    expect(later[0]).toEqual(A);
    expect(later[1][0]).toEqual(B[0]);
  });
});
