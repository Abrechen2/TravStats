import { describe, it, expect } from "vitest";
import {
  lerpRgb,
  frequencyIntensity,
  flightStatusTint,
  FLIGHT_PAST_LOW,
  FLIGHT_PAST_HIGH,
  FLIGHT_SCHEDULED_HIGH,
} from "./statusColors";

describe("lerpRgb", () => {
  it("returns the first color at t=0", () => {
    expect(lerpRgb([240, 169, 71], [249, 115, 22], 0)).toEqual([240, 169, 71]);
  });

  it("returns the second color at t=1", () => {
    expect(lerpRgb([240, 169, 71], [249, 115, 22], 1)).toEqual([249, 115, 22]);
  });

  it("returns the rounded midpoint at t=0.5", () => {
    // R: 240 + (249-240)*0.5 = 244.5 → 245 (banker's rounding is not in
    // play here — Math.round(244.5) === 245)
    // G: 169 + (115-169)*0.5 = 142
    // B: 71 + (22-71)*0.5 = 46.5 → 47
    expect(lerpRgb([240, 169, 71], [249, 115, 22], 0.5)).toEqual([245, 142, 47]);
  });

  it("clamps t above 1", () => {
    expect(lerpRgb([0, 0, 0], [10, 20, 30], 5)).toEqual([10, 20, 30]);
  });

  it("clamps t below 0", () => {
    expect(lerpRgb([0, 0, 0], [10, 20, 30], -5)).toEqual([0, 0, 0]);
  });

  it("never mutates its inputs", () => {
    const a: [number, number, number] = [240, 169, 71];
    const b: [number, number, number] = [249, 115, 22];
    lerpRgb(a, b, 0.5);
    expect(a).toEqual([240, 169, 71]);
    expect(b).toEqual([249, 115, 22]);
  });
});

describe("frequencyIntensity", () => {
  it("floors rare routes (count at or below q25) to 0.2, not 0", () => {
    expect(frequencyIntensity(1, 5, 10, 20)).toBe(0.2);
    expect(frequencyIntensity(5, 5, 10, 20)).toBe(0.2);
  });

  it("caps frequent routes (count at or above q75) to 1", () => {
    expect(frequencyIntensity(20, 5, 10, 20)).toBe(1);
    expect(frequencyIntensity(50, 5, 10, 20)).toBe(1);
  });

  it("ramps linearly between the floor and the cap", () => {
    // q25=5, q75=20 → range 15; count=12.5 is 50% of the way → 0.2 + 0.8*0.5 = 0.6
    expect(frequencyIntensity(12.5, 5, 10, 20)).toBeCloseTo(0.6);
  });

  it("stays within [0.2, 1] for a degenerate single-count dataset", () => {
    // q25 === q50 === q75 === count: the >= q75 branch wins → full intensity
    expect(frequencyIntensity(1, 1, 1, 1)).toBe(1);
  });
});

describe("flightStatusTint", () => {
  it("resolves the past family's low anchor (amber) at t=0", () => {
    expect(flightStatusTint(false, 0)).toEqual([240, 169, 71]);
    expect(flightStatusTint(false, 0)).toEqual(FLIGHT_PAST_LOW);
  });

  it("resolves the past family's high anchor (vivid orange) at t=1", () => {
    expect(flightStatusTint(false, 1)).toEqual([249, 115, 22]);
    expect(flightStatusTint(false, 1)).toEqual(FLIGHT_PAST_HIGH);
  });

  it("resolves the scheduled family's high anchor (sky blue) at t=1", () => {
    expect(flightStatusTint(true, 1)).toEqual([80, 200, 255]);
    expect(flightStatusTint(true, 1)).toEqual(FLIGHT_SCHEDULED_HIGH);
  });

  it("resolves the scheduled family's low anchor (soft blue) at t=0", () => {
    expect(flightStatusTint(true, 0)).toEqual([130, 195, 235]);
  });
});
