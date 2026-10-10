/**
 * The truth table of `shared/placeRhythm.ts`. The file is MIRRORED between
 * backend and frontend and each side runs this same table — the tile and the
 * evidence panel must name the same month, day and run.
 */
import { busiestDay, busiestIndex, longestRun } from "../placeRhythm";

describe("placeRhythm", () => {
  it("names the first bucket holding the maximum, and nothing when all are empty", () => {
    expect(busiestIndex([0, 3, 1, 3])).toBe(1);
    expect(busiestIndex([0, 0, 0])).toBeNull();
  });

  it("breaks a busiest-day tie by the earlier day, whatever order the rows came in", () => {
    const days = new Map<string, Set<string>>([
      ["2024-05-02", new Set(["a", "b"])],
      ["2024-05-01", new Set(["c", "d"])],
      ["2024-05-03", new Set(["e"])],
    ]);
    expect(busiestDay(days)).toEqual({ date: "2024-05-01", places: 2 });
    expect(busiestDay(new Map())).toBeNull();
  });

  it("finds the earliest longest run of consecutive days, across a month end", () => {
    expect(longestRun(["2024-01-31", "2024-02-01", "2024-03-05", "2024-03-06"])).toEqual({
      first: "2024-01-31",
      last: "2024-02-01",
      days: 2,
    });
    expect(longestRun(["2024-03-31", "2024-03-30", "2024-03-30"])).toEqual({
      first: "2024-03-30",
      last: "2024-03-31",
      days: 2,
    });
    expect(longestRun([])).toBeNull();
  });
});
