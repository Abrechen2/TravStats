import { describe, it, expect } from "vitest";
import { buildCruiseArc } from "../../components/layers/cruiseArc";

describe("buildCruiseArc", () => {
  it("returns a path with the requested resolution", () => {
    const path = buildCruiseArc({ lat: 53.54, lon: 9.97 }, { lat: 60.39, lon: 5.32 }, 32);
    expect(path.length).toBe(33);
    expect(path[0]).toEqual([9.97, 53.54]);
    expect(path[path.length - 1]).toEqual([5.32, 60.39]);
  });

  it("control point offsets perpendicular to the segment (non-zero lat at midpoint)", () => {
    const path = buildCruiseArc({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, 10);
    const mid = path[Math.floor(path.length / 2)];
    expect(Math.abs(mid[1])).toBeGreaterThan(0.01);
  });

  it("default resolution is 64 points (length 65)", () => {
    const path = buildCruiseArc({ lat: 0, lon: 0 }, { lat: 10, lon: 10 });
    expect(path.length).toBe(65);
  });
});
