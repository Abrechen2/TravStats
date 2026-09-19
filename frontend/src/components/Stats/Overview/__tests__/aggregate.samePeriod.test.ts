// The year comparison stops measuring unequal periods.
//
// The fixture is the plan's: 10 experiences in Jan-Sep of the previous year,
// 20 more in Oct-Dec of it, 8 in Jan-Sep of the current one, and a `today` in
// September. Before the window existed the overview reported 8 against 30
// (-73 %) — a collapse in travel that was really four months that had not
// happened yet.
import { describe, it, expect } from "vitest";
import type { DomainStats, DomainStatsMap } from "../../../../lib/stats/domain-stats";
import { comparisonWindow } from "../../../../lib/stats/comparisonWindow";
import { aggregate, delta } from "../aggregate";

/** Local parts, not an ISO instant: the window works in calendar days. */
const SEPTEMBER_18_2026 = new Date(2026, 8, 18);

function daysIn(year: number, month1: number, count: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let day = 1; day <= count; day += 1) {
    out[`${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`] = 1;
  }
  return out;
}

/** 10 events spread over Jan-Sep 2025, 20 over Oct-Dec 2025, 8 over Jan-Sep 2026. */
const dailyEvents: Record<string, number> = {
  ...daysIn(2025, 3, 10),
  ...daysIn(2025, 11, 20),
  ...daysIn(2026, 3, 8),
};

const flightStats: DomainStats = {
  domain: "flight",
  hasData: true,
  totalEvents: 38,
  countries: ["DE", "US"],
  countriesByYear: { 2025: ["DE", "US"], 2026: ["DE"] },
  summaryByYear: {},
  yearlyEvents: { 2025: 30, 2026: 8 },
  yearlyActiveDays: { 2025: 30, 2026: 8 },
  monthlyActiveDays: {},
  dailyEvents,
  dailyActiveDays: { ...dailyEvents },
  weekdayEvents: {},
  summary: { headlineKpis: [], detailRoute: "/stats?tab=flight" },
};

const statsMap: DomainStatsMap = { flight: flightStats };
const visible = { flight: true };

describe("aggregate — a running year is compared against the same span", () => {
  it("counts the previous year only up to today's day, not its whole twelve months", () => {
    const window = comparisonWindow(2026, SEPTEMBER_18_2026);
    expect(window.kind).toBe("samePeriod");

    const current = aggregate(statsMap, visible, 2026, window);
    const previous = aggregate(statsMap, visible, 2025, window);

    expect(current.totalEvents).toBe(8);
    expect(previous.totalEvents).toBe(10);
    expect(delta(current.totalEvents, previous.totalEvents)).toEqual({
      diff: -2,
      pct: -20,
      sign: "down",
    });
  });

  it("cuts the active-day union on the same day", () => {
    const window = comparisonWindow(2026, SEPTEMBER_18_2026);
    expect(aggregate(statsMap, visible, 2025, window).activeDays).toBe(10);
    expect(aggregate(statsMap, visible, 2026, window).activeDays).toBe(8);
  });

  it("leaves a COMPLETED year comparing full years", () => {
    // 2025 is over as of September 2026, so nothing about it is still
    // accruing and the old comparison is the right one.
    const window = comparisonWindow(2025, SEPTEMBER_18_2026);
    expect(window.kind).toBe("fullYear");
    expect(aggregate(statsMap, visible, 2025, window).totalEvents).toBe(30);
  });

  it("without a window, aggregate still reports the whole year", () => {
    expect(aggregate(statsMap, visible, 2025, null).totalEvents).toBe(30);
    expect(aggregate(statsMap, visible, null, null).totalEvents).toBe(38);
  });

  it("leaves the country set uncut — there is no day to cut it on", () => {
    // Three of the four domains get `countriesByYear` from the server and it
    // is year-keyed; deriving a day-level one on the client would be a second
    // source of truth for a figure the evidence panel answers from the first.
    // So the fold keeps reporting the year's whole set, and the KPI strip
    // withholds the country DELTA for a same-period window instead of
    // publishing a comparison of two different spans (see CrossDomainKpis).
    const window = comparisonWindow(2026, SEPTEMBER_18_2026);
    expect(aggregate(statsMap, visible, 2025, window).countriesCount).toBe(2);
  });
});
