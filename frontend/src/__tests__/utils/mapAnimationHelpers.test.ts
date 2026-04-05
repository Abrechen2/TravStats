import { describe, it, expect } from "vitest";
import { computeBbox, arcPosition, easeInOut } from "../../utils/mapAnimationHelpers";

describe("computeBbox", () => {
  it("returns null for empty array", () => {
    expect(computeBbox([])).toBeNull();
  });

  it("returns tight bbox for two points", () => {
    const bbox = computeBbox([
      [11.79, 48.35],
      [-73.78, 40.64],
    ]);
    expect(bbox).toEqual([-73.78, 40.64, 11.79, 48.35]);
  });

  it("handles single point", () => {
    const bbox = computeBbox([[10, 50]]);
    expect(bbox).toEqual([10, 50, 10, 50]);
  });
});

describe("arcPosition", () => {
  it("returns source at t=0", () => {
    expect(arcPosition([0, 0], [10, 10], 0)).toEqual([0, 0]);
  });

  it("returns target at t=1", () => {
    expect(arcPosition([0, 0], [10, 10], 1)).toEqual([10, 10]);
  });

  it("returns midpoint at t=0.5", () => {
    const [lon, lat] = arcPosition([0, 0], [10, 10], 0.5);
    expect(lon).toBeCloseTo(5);
    expect(lat).toBeCloseTo(5);
  });
});

describe("easeInOut", () => {
  it("returns 0 at t=0", () => expect(easeInOut(0)).toBe(0));
  it("returns 1 at t=1", () => expect(easeInOut(1)).toBe(1));
  it("returns 0.5 at t=0.5", () => expect(easeInOut(0.5)).toBeCloseTo(0.5));
  it("is slow at start and end", () => {
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
  });
});
