import { describe, expect, it } from "vitest";

import { flownVsGreatCircle } from "../flownVsGreatCircle";

describe("flownVsGreatCircle", () => {
  const MUC = { lat: 48.3538, lon: 11.7861 };
  const JFK = { lat: 40.6398, lon: -73.7789 };

  it("sets the measured distance against the great circle between the airports", () => {
    const result = flownVsGreatCircle(6950, MUC, JFK);
    expect(result).not.toBeNull();
    // MUC-JFK is ~6,480 km on the great circle.
    expect(result!.greatCircleKm).toBeGreaterThan(6400);
    expect(result!.greatCircleKm).toBeLessThan(6560);
    expect(result!.differencePercent).toBe(
      Math.round(((6950 - result!.greatCircleKm) / result!.greatCircleKm) * 100)
    );
  });

  it("says nothing when an end has no position — not a comparison against 0", () => {
    expect(flownVsGreatCircle(800, MUC, { lat: 0, lon: 0 })).toBeNull();
    expect(flownVsGreatCircle(800, MUC, null)).toBeNull();
  });

  it("says nothing for a flight that starts where it ends", () => {
    expect(flownVsGreatCircle(120, MUC, MUC)).toBeNull();
  });
});
