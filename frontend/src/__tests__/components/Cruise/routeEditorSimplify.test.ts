import { describe, it, expect } from "vitest";
import { simplifyForEditing, type LonLat } from "../../../components/Cruise/routeEditorState";

/**
 * Owner decision 2026-08-21: a raw marnet leg (Nassau→Vancouver arrived with
 * 178 waypoints) is an unusable caterpillar of handles. On editor entry the
 * line is simplified to a manageable handle count — Douglas-Peucker, so the
 * kept handles are the ones that carry the shape.
 */
describe("simplifyForEditing", () => {
  const line = (points: Array<[number, number]>): LonLat[] => points.map(([a, b]) => [a, b]);

  it("returns a short line untouched", () => {
    const input = line([
      [0, 0],
      [1, 0.5],
      [2, 0],
    ]);
    expect(simplifyForEditing(input)).toEqual(input);
  });

  it("reduces a dense line to at most the handle budget", () => {
    // 178 points along a gentle arc — the measured Nassau→Vancouver case.
    const input: LonLat[] = Array.from({ length: 178 }, (_, i) => [
      i * 0.5,
      Math.sin(i / 10) * 5,
    ]);
    const out = simplifyForEditing(input);
    expect(out.length).toBeLessThanOrEqual(25);
    expect(out.length).toBeGreaterThan(2);
  });

  it("keeps the endpoints exactly", () => {
    const input: LonLat[] = Array.from({ length: 100 }, (_, i) => [i, (i % 7) * 0.01]);
    const out = simplifyForEditing(input);
    expect(out[0]).toEqual(input[0]);
    expect(out[out.length - 1]).toEqual(input[input.length - 1]);
  });

  it("emits only input points, in their original order", () => {
    const input: LonLat[] = Array.from({ length: 60 }, (_, i) => [i, Math.cos(i / 5)]);
    const out = simplifyForEditing(input, 10);
    const indexOf = (p: LonLat): number =>
      input.findIndex(([lon, lat]) => lon === p[0] && lat === p[1]);
    const indices = out.map(indexOf);
    expect(indices).not.toContain(-1);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });

  it("a sharp corner survives while collinear filler goes", () => {
    // 50 points east, a hard corner, 50 points north — DP must keep the bend.
    const east: LonLat[] = Array.from({ length: 51 }, (_, i) => [i, 0]);
    const north: LonLat[] = Array.from({ length: 50 }, (_, i) => [50, i + 1]);
    const input = [...east, ...north];
    const out = simplifyForEditing(input, 10);
    expect(out).toContainEqual([50, 0]);
    expect(out.length).toBeLessThanOrEqual(10);
  });
});
