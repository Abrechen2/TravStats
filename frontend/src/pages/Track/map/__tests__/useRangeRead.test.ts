import { describe, expect, it, vi } from "vitest";
import type { TravTrackRange } from "../../../../lib/api/travtrackViews";
import { readRangeParts, rangeProgress } from "../useRangeRead";
import { sourceOfParts } from "../useTrackMapData";

/**
 * The range read in parts (plan T5.3): each part is handed on as it lands,
 * the cursor carries the next request, progress comes from the first instant
 * not read, and the parts' stretches stay side by side — never joined.
 */

const part = (over: Partial<TravTrackRange>): TravTrackRange => ({
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-11T00:00:00.000Z",
  segments: [],
  pointIds: [],
  pointCount: 0,
  readCount: 0,
  simplified: false,
  omittedSegments: 0,
  next: null,
  cursor: null,
  ...over,
});

const A = part({
  segments: [
    [
      [1, 37.5, 127, 5],
      [2, 37.51, 127, 5],
    ],
  ],
  pointIds: [["a1", "a2"]],
  readCount: 40,
  next: "2026-10-06T00:00:00.000Z",
  cursor: "123:9",
});
const B = part({
  segments: [
    [
      [3, 37.52, 127, 5],
      [4, 37.53, 127, 5],
    ],
  ],
  pointIds: [["b1", "b2"]],
  readCount: 30,
});

describe("range parts", () => {
  it("asks for each next part with the cursor and stops at the span's end", async () => {
    const read = vi.fn().mockResolvedValueOnce(A).mockResolvedValueOnce(B);
    const seen: TravTrackRange[] = [];
    await readRangeParts({ fromDay: "2026-10-01", toDay: "2026-10-10" }, read, (p) => {
      seen.push(p);
      return true;
    });
    expect(read.mock.calls.map((c) => c[1])).toEqual([null, "123:9"]);
    expect(seen).toEqual([A, B]);
  });

  it("stops when the reader no longer wants parts (another span was picked)", async () => {
    const read = vi.fn().mockResolvedValue(A);
    await readRangeParts({ fromDay: "2026-10-01", toDay: "2026-10-10" }, read, () => false);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("a failed part throws, after the parts before it were handed on", async () => {
    const read = vi.fn().mockResolvedValueOnce(A).mockRejectedValueOnce(new Error("down"));
    const seen: TravTrackRange[] = [];
    await expect(
      readRangeParts({ fromDay: "2026-10-01", toDay: "2026-10-10" }, read, (p) => {
        seen.push(p);
        return true;
      })
    ).rejects.toThrow("down");
    expect(seen).toEqual([A]);
  });

  it("progress is the share of the span before the first instant not read", () => {
    expect(rangeProgress(A)).toBeCloseTo(0.5, 5);
    expect(rangeProgress(B)).toBe(1);
  });

  it("parts' stretches stay separate: no stretch spans two parts", () => {
    const source = sourceOfParts([A, B]);
    expect(source.segments).toHaveLength(2);
    expect(source.segments[0].map((p) => p[0])).toEqual([1, 2]);
    expect(source.segments[1].map((p) => p[0])).toEqual([3, 4]);
    expect(source.ids).toEqual([
      ["a1", "a2"],
      ["b1", "b2"],
    ]);
    expect(source.positions).toBe(70);
    expect(source.coverage).toEqual([]);
  });
});
