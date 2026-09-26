import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adaptCruise } from "../cruiseStatsAdapter";
import type { CruiseStatsResponse } from "../../../api/stats";
import type { Cruise } from "../../../../types/cruise";

/**
 * Cruise dates are calendar days. `adaptCruise` read them in the BROWSER's
 * zone, so west of UTC every cruise began a day early: a cruise leaving on
 * 1 January 2025 was a 2024 event on the overview tile while the server —
 * and the evidence panel — put it in 2025. Run with the browser in
 * Los Angeles to make that zone observable.
 */
describe("adaptCruise with the browser west of UTC", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  const stats = {
    cruisesCount: 1,
    cruiseLines: ["AIDA"],
    countries: [],
    totalDistanceKm: 0,
    totalCruiseDays: 3,
  } as unknown as CruiseStatsResponse;

  const cruise = {
    id: "c1",
    cruiseLine: "AIDA",
    startDate: "2025-01-01",
    endDate: "2025-01-03",
    status: "flown",
    stops: [],
  } as unknown as Cruise;

  it("keeps the cruise in the calendar year and on the days it sailed", () => {
    const result = adaptCruise({ stats, cruises: [cruise] });
    if (!result.hasData) throw new Error("expected data");
    expect(result.yearlyEvents).toEqual({ 2025: 1 });
    expect(Object.keys(result.dailyActiveDays).sort()).toEqual([
      "2025-01-01",
      "2025-01-02",
      "2025-01-03",
    ]);
    // 1 January 2025 was a Wednesday.
    expect(result.weekdayEvents).toEqual({ 3: 1 });
  });
});
