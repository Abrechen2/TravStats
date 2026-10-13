import { describe, expect, it } from "vitest";
import { aggregate, fieldPaths, fieldValues, lines } from "../TravelComparison";
describe("all-travel comparison", () => {
  it("offers nested fields across all records without turning missing values into zero", () => {
    const records = [
      { legs: [{ distanceKm: 2 }, { distanceKm: 3 }], fare: null },
      { legs: [{ distanceKm: 4 }], fare: 20 },
    ];
    expect([...fieldPaths(records)]).toContain("legs.distanceKm");
    expect(fieldValues(records, ["legs", "distanceKm"])).toEqual([2, 3, 4]);
    expect(aggregate([], "sum")).toBeNull();
    expect(aggregate([2, 3, 4], "sum")).toBe(9);
    expect(aggregate(["2", 3], "sum")).toBeNull();
  });
  it("preserves recording gaps and does not draw a false line across the dateline", () => {
    const track = {
      geometry: {
        type: "LineString",
        coordinates: [
          [1, 1],
          [2, 2],
          [10, 10],
          [11, 11],
          [179, 12],
          [-179, 13],
          [-178, 14],
        ],
      },
      segmentStarts: [0, 2, 4],
    };
    expect(lines(track)).toEqual([
      [
        [1, 1],
        [2, 2],
      ],
      [
        [10, 10],
        [11, 11],
      ],
      [
        [-179, 13],
        [-178, 14],
      ],
    ]);
  });
});
