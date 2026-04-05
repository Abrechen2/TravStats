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
    const [lon, lat] = arcPosition([0, 0], [10, 10], 0);
    expect(lon).toBeCloseTo(0);
    expect(lat).toBeCloseTo(0);
  });

  it("returns target at t=1", () => {
    const [lon, lat] = arcPosition([0, 0], [10, 10], 1);
    expect(lon).toBeCloseTo(10);
    expect(lat).toBeCloseTo(10);
  });

  it("midpoint lies between source and target", () => {
    const [lon, lat] = arcPosition([0, 0], [10, 10], 0.5);
    // Great-circle midpoint is close to the linear midpoint for short arcs
    expect(lon).toBeCloseTo(5, 0);
    expect(lat).toBeCloseTo(5, 0);
  });

  it("handles identical source and target (zero distance fallback)", () => {
    const [lon, lat] = arcPosition([11.79, 48.35], [11.79, 48.35], 0.5);
    expect(lon).toBeCloseTo(11.79);
    expect(lat).toBeCloseTo(48.35);
  });

  it("long-haul arc midpoint is not the linear midpoint", () => {
    // MUC [11.79, 48.35] → LAX [-118.41, 33.94]
    // On the great circle the midpoint diverges noticeably from the linear midpoint
    const [lon, lat] = arcPosition([11.79, 48.35], [-118.41, 33.94], 0.5);
    const linearLat = (48.35 + 33.94) / 2;
    // The slerp midpoint latitude should be higher than the linear midpoint (polar arc)
    expect(lat).toBeGreaterThan(linearLat);
    // Longitude stays in the same general hemisphere
    expect(lon).toBeGreaterThan(-180);
    expect(lon).toBeLessThan(180);
  });

  it("antimeridian route (LAX → NRT) produces midpoint in the Pacific, not over Europe", () => {
    // LAX lon ≈ -118°, NRT lon ≈ +140°
    // The short path crosses the Pacific (antimeridian); midpoint should be near lon 180° / -180°
    // and NOT near 0° (which would indicate the route went westward through Europe)
    const [lon] = arcPosition([-118.41, 33.94], [139.77, 35.76], 0.5);
    // Midpoint must NOT be near the Greenwich meridian (Europe route)
    expect(Math.abs(lon)).toBeGreaterThan(90);
  });

  it("antimeridian route endpoints are returned correctly at t=0 and t=1", () => {
    const [lon0, lat0] = arcPosition([-118.41, 33.94], [139.77, 35.76], 0);
    expect(lon0).toBeCloseTo(-118.41);
    expect(lat0).toBeCloseTo(33.94);

    const [lon1, lat1] = arcPosition([-118.41, 33.94], [139.77, 35.76], 1);
    expect(lon1).toBeCloseTo(139.77);
    expect(lat1).toBeCloseTo(35.76);
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
