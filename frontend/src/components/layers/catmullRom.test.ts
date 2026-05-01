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

  it("interpolates the short way across the antimeridian (179° → -179° is 2°, not 358°)", () => {
    const pts = catmullRomSpline([
      [178, 50],
      [179, 50],
      [-179, 50],
      [-178, 50],
    ]);
    // Every output longitude must be near the great-circle short path
    // through 180°; bouncing back near 0° (the long way around) is the
    // failure we're guarding against.
    for (const [lon] of pts) {
      const distFrom180 = Math.min(Math.abs(lon - 180), Math.abs(lon + 180), Math.abs(lon - -180));
      // All samples should sit within ~5° of the antimeridian.
      expect(distFrom180).toBeLessThan(5);
    }
    // Output longitudes are normalised back into [-180, 180].
    for (const [lon] of pts) {
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    }
  });
});
