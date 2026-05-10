import { describe, it, expect } from "vitest";
import { cameraDistanceFromViewport } from "../EarthOcclusionExtension";

const EARTH_RADIUS_M = 6371000;
const RADIUS_IN_UNITS = 256; // deck.gl GlobeViewport common-space convention
const UNITS_PER_METER = RADIUS_IN_UNITS / EARTH_RADIUS_M;

function viewportAt(distInRadii: number): {
  cameraPosition: readonly [number, number, number];
  distanceScales: { unitsPerMeter: readonly [number, number, number] };
} {
  const mag = distInRadii * RADIUS_IN_UNITS;
  return {
    // Direction doesn't matter for magnitude — pick a clean axis.
    cameraPosition: [mag, 0, 0],
    distanceScales: { unitsPerMeter: [UNITS_PER_METER, UNITS_PER_METER, UNITS_PER_METER] },
  };
}

describe("cameraDistanceFromViewport", () => {
  it("recovers a 5.1-Earth-radius camera (typical zoom 1.6) from camera position", () => {
    const dist = cameraDistanceFromViewport(viewportAt(5.1));
    expect(dist).toBeCloseTo(5.1, 3);
  });

  it("recovers a 55.85-Earth-radius camera (very low zoom) accurately", () => {
    const dist = cameraDistanceFromViewport(viewportAt(55.85));
    expect(dist).toBeCloseTo(55.85, 2);
  });

  it("returns the safe upper-bound fallback when viewport has no cameraPosition", () => {
    const dist = cameraDistanceFromViewport({});
    expect(dist).toBeGreaterThan(1);
    // Falls back to under-clipping rather than over-clipping.
    expect(dist).toBeGreaterThanOrEqual(6);
  });

  it("returns the fallback when distanceScales is missing or zero", () => {
    const dist = cameraDistanceFromViewport({
      cameraPosition: [1000, 0, 0],
      distanceScales: { unitsPerMeter: [0, 0, 0] },
    });
    expect(dist).toBeGreaterThanOrEqual(6);
  });

  it("returns the fallback when computed distance would land below the surface", () => {
    // Camera at 0.5 ER (below surface) — adapter should refuse it.
    const dist = cameraDistanceFromViewport(viewportAt(0.5));
    expect(dist).toBeGreaterThanOrEqual(6);
  });

  it("matches the camera magnitude regardless of camera direction", () => {
    const target = 4.2;
    const mag = target * RADIUS_IN_UNITS;
    const dist = cameraDistanceFromViewport({
      cameraPosition: [mag / Math.sqrt(3), mag / Math.sqrt(3), mag / Math.sqrt(3)],
      distanceScales: { unitsPerMeter: [UNITS_PER_METER, UNITS_PER_METER, UNITS_PER_METER] },
    });
    expect(dist).toBeCloseTo(target, 3);
  });
});
