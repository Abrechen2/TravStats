import { describe, it, expect } from "vitest";
import {
  simplifyLineString,
  perpendicularKm,
  toleranceKmForZoom,
  type LonLat,
} from "../../../shared/geo/simplifyLineString";

describe("simplifyLineString — edge cases", () => {
  it("returns short inputs unchanged", () => {
    const input: LonLat[] = [
      [0, 0],
      [10, 10],
    ];
    expect(simplifyLineString(input, 5)).toEqual(input);
  });

  it("returns a copy of the input when tolerance is zero", () => {
    const input: LonLat[] = [
      [0, 0],
      [1, 0.01],
      [2, 0],
    ];
    const out = simplifyLineString(input, 0);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it("keeps the first and last point", () => {
    const input: LonLat[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ];
    const out = simplifyLineString(input, 100);
    expect(out[0]).toEqual(input[0]);
    expect(out[out.length - 1]).toEqual(input[input.length - 1]);
  });
});

describe("simplifyLineString — straight line", () => {
  it("drops collinear interior points when tolerance is loose", () => {
    const input: LonLat[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ];
    const out = simplifyLineString(input, 1);
    expect(out).toEqual([
      [0, 0],
      [4, 0],
    ]);
  });

  it("keeps a significant kink when tolerance is tight", () => {
    const input: LonLat[] = [
      [0, 0],
      [1, 0],
      // A 2-degree detour south at the middle — about 222 km from the chord.
      [2, -2],
      [3, 0],
      [4, 0],
    ];
    // Tight tolerance — the detour must stay in the output.
    const out = simplifyLineString(input, 50);
    expect(out).toContainEqual([2, -2]);
  });

  it("ignores a small wiggle when tolerance covers it", () => {
    const input: LonLat[] = [
      [0, 0],
      [1, 0.001], // about 111 metres off the chord
      [2, 0],
    ];
    const out = simplifyLineString(input, 1); // 1 km tolerance
    expect(out).toEqual([
      [0, 0],
      [2, 0],
    ]);
  });
});

describe("perpendicularKm — geometry sanity", () => {
  it("point on the line has zero distance", () => {
    expect(perpendicularKm([0, 0], [4, 0], [2, 0])).toBeCloseTo(0, 3);
  });

  it("1° of latitude perpendicular offset is about 111 km", () => {
    const d = perpendicularKm([0, 0], [4, 0], [2, 1]);
    expect(d).toBeCloseTo(111.132, 1);
  });

  it("clamps to segment endpoints (no negative projections)", () => {
    // Point is past segment end; distance is to the endpoint, not to the
    // infinite line.
    const d = perpendicularKm([0, 0], [4, 0], [6, 0]);
    const kmPerDegLat = 111.132;
    // 2° east of the (4,0) endpoint, at equator → 2 * KM_PER_DEG_LAT.
    expect(d).toBeCloseTo(2 * kmPerDegLat, 0);
  });

  it("degenerate segment (a == b) falls back to great-circle-ish distance", () => {
    const d = perpendicularKm([0, 0], [0, 0], [0, 1]);
    expect(d).toBeCloseTo(111.132, 1);
  });
});

describe("toleranceKmForZoom", () => {
  it.each([
    [0, 50],
    [3, 50],
    [4, 20],
    [6, 20],
    [7, 5],
    [9, 5],
    [10, 0],
    [15, 0],
  ])("zoom %i → %i km", (zoom, expected) => {
    expect(toleranceKmForZoom(zoom)).toBe(expected);
  });
});

describe("simplifyLineString — realistic reduction", () => {
  it("compresses a 100-point near-straight polyline to ~2 points", () => {
    const coords: LonLat[] = [];
    for (let i = 0; i <= 100; i++) {
      // Gentle sine ≤ 0.5 km amplitude at the equator.
      const lon = i * 0.1;
      const lat = Math.sin((i * Math.PI) / 50) * 0.004; // <0.5 km
      coords.push([lon, lat]);
    }
    const out = simplifyLineString(coords, 50);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out[0]).toEqual(coords[0]);
    expect(out[out.length - 1]).toEqual(coords[coords.length - 1]);
  });
});
