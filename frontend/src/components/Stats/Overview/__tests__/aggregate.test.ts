import { describe, it, expect } from "vitest";
import type { DomainStatsMap } from "../../../../lib/stats/domain-stats";
import type { VisitedCountrySource } from "../../../../shared/crossDomainCounting";
import {
  aggregate,
  collectYears,
  delta,
  isWithData,
  pickAdjacentYear,
  resolveStaleCompareYear,
} from "../aggregate";

const flightStats = {
  domain: "flight" as const,
  hasData: true as const,
  summaryByYear: {},
  totalEvents: 10,
  totalDistanceKm: 12_000,
  totalDurationHours: 24,
  countries: ["DE", "US", "JP"],
  countriesByYear: { 2023: ["DE", "JP"], 2024: ["DE", "US"] },
  yearlyEvents: { 2023: 4, 2024: 6 },
  // The same tally by day — it sums per year to `yearlyEvents`, which is
  // the contract `eventsInWindow` relies on.
  dailyEvents: { "2023-06-01": 4, "2024-03-15": 6 },
  yearlyActiveDays: { 2023: 4, 2024: 6 },
  monthlyActiveDays: { "2023-06": 2, "2024-03": 3 },
  dailyActiveDays: { "2023-06-01": 1, "2024-03-15": 1 },
  weekdayEvents: {},
  summary: {
    headlineKpis: [{ labelKey: "overviewCard.kpi.distance", value: 12_000, unit: "km" as const }],
    detailRoute: "/stats?tab=flight",
  },
};

const cruiseStats = {
  domain: "cruise" as const,
  hasData: true as const,
  summaryByYear: {},
  totalEvents: 3,
  totalDistanceKm: 5_000,
  countries: ["IT", "ES", "DE"],
  countriesByYear: { 2024: ["IT", "DE"], 2025: ["ES"] },
  yearlyEvents: { 2024: 2, 2025: 1 },
  dailyEvents: { "2024-06-10": 2, "2025-03-04": 1 },
  yearlyActiveDays: { 2024: 14, 2025: 7 },
  monthlyActiveDays: { "2024-06": 14, "2025-03": 7 },
  dailyActiveDays: { "2024-06-10": 1, "2024-06-11": 1 },
  weekdayEvents: {},
  summary: {
    headlineKpis: [{ labelKey: "overviewCard.kpi.distance", value: 5_000, unit: "km" as const }],
    detailRoute: "/stats?tab=cruise",
  },
};

const baseMap: DomainStatsMap = {
  flight: flightStats,
  cruise: cruiseStats,
};

describe("aggregate", () => {
  it("sums lifetime events across visible domains", () => {
    const result = aggregate(baseMap, { flight: true, cruise: true }, null);
    expect(result.totalEvents).toBe(13);
    expect(result.perDomainEvents).toEqual({ flight: 10, cruise: 3 });
  });

  it("year-scoped events use yearlyEvents map", () => {
    const result = aggregate(baseMap, { flight: true, cruise: true }, 2024);
    expect(result.totalEvents).toBe(8);
    expect(result.perDomainEvents).toEqual({ flight: 6, cruise: 2 });
  });

  it("hidden domains are excluded", () => {
    const result = aggregate(baseMap, { flight: true, cruise: false }, null);
    expect(result.totalEvents).toBe(10);
    expect(result.perDomainEvents).toEqual({ flight: 10 });
  });

  /**
   * "Länder besucht" counts by the passport's visited rule (forgejo#299), from
   * the per-domain `visitSources` the passport publishes — never from the
   * countries a domain's records merely TOUCHED. The adapters above list
   * DE/US/JP and IT/ES/DE as touched; the index says which were visited.
   */
  describe("countries: the passport's visited index, scoped by chip and year", () => {
    const visited: VisitedCountrySource[] = [
      { code: "DE", domain: "flight", years: [2023, 2024], undated: false },
      { code: "JP", domain: "flight", years: [2023], undated: false },
      { code: "IT", domain: "cruise", years: [2024], undated: false },
      { code: "DE", domain: "cruise", years: [2024], undated: false },
      { code: "BE", domain: "poi", years: [], undated: true },
    ];

    it("counts visited countries only — a touched country without a visit does not count", () => {
      // US (flights) and ES (cruise) are in the adapters' touched sets but
      // not visited: a connection and a port nobody went ashore at in the
      // fixture. The tile read 5 before forgejo#299; it reads 3.
      const lifetime = aggregate(baseMap, { flight: true, cruise: true }, null, null, visited);
      expect(lifetime.countriesCount).toBe(3); // DE, JP, IT
    });

    it("unions a country visited in two domains once", () => {
      const y2024 = aggregate(baseMap, { flight: true, cruise: true }, 2024, null, visited);
      expect(y2024.countriesCount).toBe(2); // DE (both), IT
    });

    it("follows the chips: a hidden domain's visits do not count", () => {
      const flightOnly = aggregate(baseMap, { flight: true, cruise: false }, 2024, null, visited);
      expect(flightOnly.countriesCount).toBe(1); // DE
    });

    it("scopes to the year, so the delta can be real", () => {
      const y2023 = aggregate(baseMap, { flight: true, cruise: true }, 2023, null, visited);
      expect(y2023.countriesCount).toBe(2); // DE, JP
      expect(aggregate(baseMap, { flight: true, cruise: true }, 1999, null, visited)).toMatchObject(
        { countriesCount: 0 }
      );
    });

    it("counts an undated visit for the lifetime only, and only from a folded domain", () => {
      // POI is not in this stats map, so its visit is not on the strip.
      expect(
        aggregate({ ...baseMap }, { flight: true, cruise: true, poi: true }, null, null, visited)
          .countriesCount
      ).toBe(3);
    });

    it("abstains (null) while the index is not there, instead of falling back to touched countries", () => {
      expect(aggregate(baseMap, { flight: true, cruise: true }, null).countriesCount).toBeNull();
    });
  });

  describe("activeDays counts DAYS, not one tally per domain", () => {
    // The KPI is contracted as "distinct travel days (any visible domain
    // active)" and labelled "Tage mit mind. einer Aktivität". It used to ADD
    // each domain's own tally, so a day with a flight AND a hotel night
    // counted twice — and the figure could pass 365 in a year. The union has
    // to be taken over the day keys, which every domain already supplies as
    // `dailyActiveDays` (the heatmap has always used them).
    const overlapping: DomainStatsMap = {
      flight: {
        ...flightStats,
        yearlyActiveDays: { 2024: 2 },
        dailyActiveDays: { "2024-03-15": 1, "2024-03-16": 1 },
      },
      lodging: {
        ...cruiseStats,
        domain: "lodging",
        yearlyActiveDays: { 2024: 2 },
        // 03-16 is the same day: flown in, slept there.
        dailyActiveDays: { "2024-03-16": 1, "2024-03-17": 1 },
      },
    };

    it("counts a day shared by two domains once", () => {
      const result = aggregate(overlapping, { flight: true, lodging: true }, 2024);
      expect(result.activeDays).toBe(3);
    });

    it("counts the same days once over the lifetime too", () => {
      const result = aggregate(overlapping, { flight: true, lodging: true }, null);
      expect(result.activeDays).toBe(3);
    });

    it("keeps a year selection to that year's days", () => {
      const spanning: DomainStatsMap = {
        flight: {
          ...flightStats,
          dailyActiveDays: { "2023-12-31": 1, "2024-01-01": 1, "2024-01-02": 1 },
        },
      };
      expect(aggregate(spanning, { flight: true }, 2024).activeDays).toBe(2);
      expect(aggregate(spanning, { flight: true }, 2023).activeDays).toBe(1);
      expect(aggregate(spanning, { flight: true }, null).activeDays).toBe(3);
    });

    it("falls back to the domain's own tally when it has no day index", () => {
      // Same reasoning as the country fallback right above: a domain that
      // predates `dailyActiveDays` must not contribute zero. Over-reporting
      // is visible, under-reporting silently loses days.
      const legacy = {
        flight: { ...flightStats, dailyActiveDays: undefined },
      } as unknown as DomainStatsMap;
      expect(aggregate(legacy, { flight: true }, 2024).activeDays).toBe(6);
    });
  });

  it("ignores hasData=false domain entries", () => {
    const map: DomainStatsMap = {
      ...baseMap,
      lodging: { domain: "lodging", hasData: false },
    };
    const result = aggregate(map, { flight: true, cruise: true, lodging: true }, null);
    expect(result.totalEvents).toBe(13);
    expect(result.perDomainEvents.lodging).toBeUndefined();
  });
});

describe("delta", () => {
  it("returns null when previous is undefined", () => {
    expect(delta(5, undefined)).toBeNull();
  });

  it("returns up sign with diff and pct", () => {
    expect(delta(15, 10)).toEqual({ diff: 5, pct: 50, sign: "up" });
  });

  it("returns down sign with negative diff", () => {
    expect(delta(8, 10)).toEqual({ diff: -2, pct: -20, sign: "down" });
  });

  it("returns flat sign when diff is 0", () => {
    expect(delta(10, 10)).toEqual({ diff: 0, pct: 0, sign: "flat" });
  });

  it("returns null pct when previous is 0 (avoids division by zero)", () => {
    const result = delta(5, 0);
    expect(result?.diff).toBe(5);
    expect(result?.pct).toBeNull();
  });

  it("returns null when current or previous is non-finite", () => {
    expect(delta(Number.NaN, 10)).toBeNull();
    expect(delta(10, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("collectYears", () => {
  it("returns sorted union of years across visible domains", () => {
    expect(collectYears(baseMap, { flight: true, cruise: true })).toEqual([2023, 2024, 2025]);
  });

  it("excludes hidden domains", () => {
    expect(collectYears(baseMap, { flight: false, cruise: true })).toEqual([2024, 2025]);
  });

  it("returns empty when nothing visible", () => {
    expect(collectYears(baseMap, { flight: false, cruise: false })).toEqual([]);
  });
});

describe("isWithData", () => {
  it("type-guards hasData=true", () => {
    expect(isWithData(flightStats)).toBe(true);
  });

  it("rejects hasData=false", () => {
    expect(isWithData({ domain: "lodging", hasData: false })).toBe(false);
  });
});

describe("pickAdjacentYear", () => {
  it("prefers the chronologically closest year", () => {
    expect(pickAdjacentYear([2020, 2022, 2023], 2024)).toBe(2023);
  });

  it("skips the current year itself", () => {
    expect(pickAdjacentYear([2023, 2024], 2024)).toBe(2023);
  });

  it("ties prefer the older year", () => {
    expect(pickAdjacentYear([2022, 2024], 2023)).toBe(2022);
  });

  it("returns null when no other candidate exists", () => {
    expect(pickAdjacentYear([2024], 2024)).toBeNull();
    expect(pickAdjacentYear([], 2024)).toBeNull();
  });

  it("picks the most recent year when current is null", () => {
    expect(pickAdjacentYear([2021, 2022, 2023], null)).toBe(2023);
  });
});

// Covers issue #188's stale-year requirement: a persisted compareYear
// (from localStorage) can go stale in ways a same-session pick never
// could — deleted trips, a different dataset, or fewer than 2 years of
// data at all. The comparison must fall back gracefully, never crash,
// and must not render a comparison against a year with no data.
describe("resolveStaleCompareYear", () => {
  it("returns null (no change) when compareYear is null", () => {
    expect(resolveStaleCompareYear([2023, 2024], 2024, null)).toBeNull();
  });

  it("returns null (no change) when compareYear is valid and not the selected year", () => {
    expect(resolveStaleCompareYear([2022, 2023, 2024], 2024, 2023)).toBeNull();
  });

  it("falls back to the closest other year when compareYear no longer exists", () => {
    // e.g. the user deleted all 2023 trips since choosing it as compareYear.
    const result = resolveStaleCompareYear([2022, 2024], 2024, 2023);
    expect(result).toEqual({ compareYear: 2022, disableCompare: false });
  });

  it("falls back when compareYear equals the newly selected year", () => {
    const result = resolveStaleCompareYear([2023, 2024], 2024, 2024);
    expect(result).toEqual({ compareYear: 2023, disableCompare: false });
  });

  it("disables comparison when no fallback year exists (single year of data)", () => {
    // Brand-new install / thinned-out dataset with only one year left,
    // but a persisted compareEnabled/compareYear from a richer dataset.
    const result = resolveStaleCompareYear([2024], 2024, 2023);
    expect(result).toEqual({ compareYear: null, disableCompare: true });
  });

  it("disables comparison when there are no years at all", () => {
    const result = resolveStaleCompareYear([], null, 2023);
    expect(result).toEqual({ compareYear: null, disableCompare: true });
  });
});
