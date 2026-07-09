import { describe, it, expect } from "vitest";
import { computeYearTicks } from "../GlobeTimeHistogram";

describe("computeYearTicks", () => {
  it("returns a single year when the range doesn't span a year boundary", () => {
    expect(computeYearTicks(2024, 2024)).toEqual([2024]);
  });

  it("always includes both endpoints, not just the start", () => {
    const ticks = computeYearTicks(2019, 2026);
    expect(ticks[0]).toBe(2019);
    expect(ticks[ticks.length - 1]).toBe(2026);
  });

  it("shows every year for a short span (#Zeitachse — was start/end only)", () => {
    expect(computeYearTicks(2021, 2026)).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
  });

  it("picks a coarser step for a long span so the tick count stays bounded", () => {
    const ticks = computeYearTicks(1990, 2026, 6);
    expect(ticks.length).toBeLessThanOrEqual(7); // maxTicks + the forced final endpoint
    expect(ticks[0]).toBe(1990);
    expect(ticks[ticks.length - 1]).toBe(2026);
    // Every step but the last should be the same "nice" size.
    const steps = ticks.slice(1, -1).map((y, i) => y - ticks[i]);
    expect(new Set(steps).size).toBeLessThanOrEqual(1);
  });

  it("respects a custom maxTicks", () => {
    const ticks = computeYearTicks(2000, 2020, 3);
    expect(ticks.length).toBeLessThanOrEqual(4);
  });
});
