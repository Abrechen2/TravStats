import { describe, it, expect } from "vitest";

import { adaptTour } from "../tourStatsAdapter";
import type { CountedTour } from "../../../../types/statsInsights";

const tour = (overrides: Partial<CountedTour>): CountedTour => ({
  id: "t1",
  year: 2024,
  day: "2024-07-12",
  km: 12.4,
  partial: false,
  ...overrides,
});

describe("adaptTour", () => {
  it("is empty without a counted tour", () => {
    expect(adaptTour({ tours: [] })).toEqual({ domain: "tour", hasData: false });
  });

  it("counts each tour once, on its day and in its year, and contributes no country", () => {
    const stats = adaptTour({
      tours: [
        tour({ id: "a" }),
        tour({ id: "b", day: "2024-07-12", km: 8 }),
        tour({ id: "c", year: 2025, day: "2025-01-02", km: null }),
      ],
    });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.totalEvents).toBe(3);
    expect(stats.yearlyEvents).toEqual({ 2024: 2, 2025: 1 });
    expect(stats.dailyEvents).toEqual({ "2024-07-12": 2, "2025-01-02": 1 });
    // Two tours on one day are one active day.
    expect(stats.yearlyActiveDays).toEqual({ 2024: 1, 2025: 1 });
    expect(stats.countries).toEqual([]);
    expect(stats.totalDistanceKm).toBeCloseTo(20.4);
  });

  it("leaves the distance out when no tour has one, never a 0 km card", () => {
    const stats = adaptTour({ tours: [tour({ km: null })] });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.totalDistanceKm).toBeUndefined();
    expect(stats.summary.headlineKpis.map((k) => k.labelKey)).toEqual(["overviewCard.kpi.tours"]);
  });

  it("counts an undated recording in the lifetime figures and in no year", () => {
    const stats = adaptTour({ tours: [tour({ year: null, day: null })] });
    if (!stats.hasData) throw new Error("expected data");
    expect(stats.totalEvents).toBe(1);
    expect(stats.yearlyEvents).toEqual({});
  });
});
