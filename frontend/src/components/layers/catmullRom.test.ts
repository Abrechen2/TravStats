import { describe, it, expect } from "vitest";
import { catmullRomSpline } from "./catmullRom";

describe("catmullRomSpline", () => {
  it("returns the input unchanged when < 2 points", () => {
    expect(catmullRomSpline([])).toEqual([]);
    expect(catmullRomSpline([[0, 0]])).toEqual([[0, 0]]);
  });

  it("returns a direct chord unchanged when exactly 2 points", () => {
    expect(
      catmullRomSpline([
        [0, 0],
        [10, 10],
      ])
    ).toEqual([
      [0, 0],
      [10, 10],
    ]);
  });

  it("passes through the first and last waypoints exactly", () => {
    const pts = catmullRomSpline([
      [0, 0],
      [5, 5],
      [10, 0],
      [15, -5],
    ]);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([15, -5]);
  });

  it("produces (waypoints - 1) * samples + 1 points by default", () => {
    // 4 waypoints × 12 samples each for 3 segments + 1 final endpoint
    const pts = catmullRomSpline([
      [0, 0],
      [5, 5],
      [10, 0],
      [15, -5],
    ]);
    expect(pts.length).toBe(3 * 12 + 1);
  });

  it("honours samplesPerSegment parameter", () => {
    const pts = catmullRomSpline(
      [
        [0, 0],
        [5, 5],
        [10, 0],
      ],
      4
    );
    expect(pts.length).toBe(2 * 4 + 1);
  });

  it("smooths a three-waypoint curve (interior point lies near the arc, not on the chord)", () => {
    const pts = catmullRomSpline([
      [0, 0],
      [5, 2],
      [10, 0],
    ]);
    // Find the midpoint sample — it should be near y ≈ 2, not y ≈ 0 (chord).
    const mid = pts[Math.floor(pts.length / 2)];
    expect(mid[1]).toBeGreaterThan(1);
  });
});
