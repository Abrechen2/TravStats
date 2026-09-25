import { splitAtLongSteps } from "../splitAtLongSteps";
import { ingestTrack } from "../../tour/tracks/ingestTrack";
import type { ParsedTrack } from "../../tour/tracks/parseGpx";

function parsed(points: Array<[number, number]>, segmentStarts = [0]): ParsedTrack {
  return {
    points,
    segmentStarts,
    startedAt: new Date("2026-06-01T08:00:00Z"),
    endedAt: new Date("2026-06-01T20:00:00Z"),
    name: null,
  };
}

describe("splitAtLongSteps", () => {
  // Three points a few km apart, then 100 km of silence, then three more.
  const points: Array<[number, number]> = [
    [5, 54.0],
    [5, 54.02],
    [5, 54.04],
    [5, 54.94],
    [5, 54.96],
    [5, 54.98],
  ];

  it("starts a new segment at a step longer than the limit", () => {
    expect(splitAtLongSteps(parsed(points), 20).segmentStarts).toEqual([0, 3]);
  });

  it("keeps the file's own boundaries and does not touch the input", () => {
    const input = parsed(points, [0, 1]);
    const out = splitAtLongSteps(input, 20);
    expect(out.segmentStarts).toEqual([0, 1, 3]);
    expect(input.segmentStarts).toEqual([0, 1]);
  });

  it("leaves the hole out of the raw distance once ingested", () => {
    const joined = ingestTrack(parsed(points))!;
    const split = ingestTrack(splitAtLongSteps(parsed(points), 20))!;
    // 4 × 0.02° recorded ≈ 8.9 km; the 0.9° jump (100 km) only in the joined one.
    expect(split.distanceKm).toBeCloseTo(4 * 0.02 * 111.2, 0);
    expect(joined.distanceKm - split.distanceKm).toBeCloseTo(0.9 * 111.2, 0);
  });
});
