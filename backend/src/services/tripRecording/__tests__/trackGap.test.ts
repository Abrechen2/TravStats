import {
  displaySegments,
  rawSegments,
  splitAtGaps,
  withoutJitter,
  type StoredPoint,
} from "../segments";
import { DEFAULT_TRACK_GAP_MINUTES, clampTrackGapMinutes, trackGapMsOf } from "../trackGapBounds";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 8, 9, 0, 0);

/** A walk: one fix a minute heading north (~110 m a minute), `n` fixes from `startMin`. */
function walk(startMin: number, n: number, lat0 = 48.37): StoredPoint[] {
  return Array.from({ length: n }, (_, i) => [
    T0 + (startMin + i) * MIN,
    lat0 + (startMin + i) * 0.001,
    10.89,
    10,
  ]);
}

describe("track split: a time gap only, as Dawarich does it", () => {
  it("a walk with two 10-minute pauses is one track, not three entries", () => {
    // Three stretches of 20 fixes with 10 minutes of silence between them.
    const points = [...walk(0, 20), ...walk(30, 20), ...walk(60, 20)];
    expect(splitAtGaps(points)).toHaveLength(1);
    expect(rawSegments([{ points }])).toHaveLength(1);
  });

  it("a silence above the user's gap splits, one at or below it does not", () => {
    const points = [...walk(0, 20), ...walk(50, 20)]; // 31 min of silence
    expect(splitAtGaps(points, [], 30 * MIN)).toHaveLength(2);
    expect(splitAtGaps(points, [], 31 * MIN)).toHaveLength(1);
    expect(splitAtGaps(points, [], 45 * MIN)).toHaveLength(1);
  });

  it("a distance jump alone no longer splits a track (it used to above 50 km)", () => {
    const a: StoredPoint = [T0, 48.0, 10.0, 10];
    const b: StoredPoint = [T0 + 5 * MIN, 49.0, 11.0, 10]; // ~130 km in five minutes
    expect(splitAtGaps([a, b])).toHaveLength(1);
  });

  it("the jitter filter reads the same time-only rule: no distance cut after it either", async () => {
    const points: StoredPoint[] = [
      [T0, 48.0, 10.0, 10],
      [T0 + 5 * MIN, 48.3, 10.3, 10],
      [T0 + 10 * MIN, 48.6, 10.6, 10],
    ];
    const { segments } = await withoutJitter([{ points }]);
    expect(segments).toHaveLength(1);
  });

  it("a silence above the gap passed to the jitter filter cuts there", async () => {
    const points = [...walk(0, 6), ...walk(40, 6)];
    expect((await withoutJitter([{ points }], 30 * MIN)).segments).toHaveLength(2);
    expect((await withoutJitter([{ points }], 60 * MIN)).segments).toHaveLength(1);
  });

  it("a track needs two points: a lone fix between two gaps is not drawn", () => {
    const lone: StoredPoint[] = [[T0, 48.0, 10.0, 10]];
    const drawn = displaySegments([lone, walk(0, 5)]);
    expect(drawn).toHaveLength(1);
  });

  it("the gap setting is clamped to its bounds and falls back to the default", () => {
    expect(clampTrackGapMinutes(1)).toBe(5);
    expect(clampTrackGapMinutes(99_999)).toBe(720);
    expect(clampTrackGapMinutes("x")).toBe(DEFAULT_TRACK_GAP_MINUTES);
    expect(trackGapMsOf(undefined)).toBe(DEFAULT_TRACK_GAP_MINUTES * MIN);
  });
});
