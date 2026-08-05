import { describe, it, expect } from "vitest";
import type { DomainStatsMap } from "../../../../lib/stats/domain-stats";
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
  totalEvents: 10,
  totalDistanceKm: 12_000,
  totalDurationHours: 24,
  countries: ["DE", "US", "JP"],
  countriesByYear: { 2023: ["DE", "JP"], 2024: ["DE", "US"] },
  yearlyEvents: { 2023: 4, 2024: 6 },
  yearlyActiveDays: { 2023: 4, 2024: 6 },
  monthlyActiveDays: { "2023-06": 2, "2024-03": 3 },
  dailyActiveDays: { "2023-06-01": 1, "2024-03-15": 1 },
  weekdayEvents: {},
  summary: {
    headlineKpis: [{ label: "Distanz", value: "12k km" }],
    detailRoute: "/stats?tab=flight",
  },
};

const cruiseStats = {
  domain: "cruise" as const,
  hasData: true as const,
  totalEvents: 3,
  totalDistanceKm: 5_000,
  countries: ["IT", "ES", "DE"],
  countriesByYear: { 2024: ["IT", "DE"], 2025: ["ES"] },
  yearlyEvents: { 2024: 2, 2025: 1 },
  yearlyActiveDays: { 2024: 14, 2025: 7 },
  monthlyActiveDays: { "2024-06": 14, "2025-03": 7 },
  dailyActiveDays: { "2024-06-10": 1, "2024-06-11": 1 },
  weekdayEvents: {},
  summary: {
    headlineKpis: [{ label: "Distanz", value: "5k km" }],
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

  it("countries are unioned across domains (DE overlaps, JP+US+IT+ES unique)", () => {
    const lifetime = aggregate(baseMap, { flight: true, cruise: true }, null);
    expect(lifetime.countriesCount).toBe(5);
  });

  // Until 2.5.0 the country count ignored the selected year entirely — it
  // returned the lifetime set for every year, which made the tile's
  // year-over-year delta structurally always zero.
  describe("year-scoped countries", () => {
    it("counts only the selected year's countries, not the lifetime set", () => {
      // 2024: flights DE+US, cruises IT+DE -> DE, US, IT = 3 (lifetime is 5)
      const result = aggregate(baseMap, { flight: true, cruise: true }, 2024);
      expect(result.countriesCount).toBe(3);
    });

    it("produces a different count per year, so the delta can be real", () => {
      const y2023 = aggregate(baseMap, { flight: true, cruise: true }, 2023);
      const y2025 = aggregate(baseMap, { flight: true, cruise: true }, 2025);
      expect(y2023.countriesCount).toBe(2); // DE, JP
      expect(y2025.countriesCount).toBe(1); // ES
      expect(y2023.countriesCount).not.toBe(y2025.countriesCount);
    });

    it("still unions across domains within the year", () => {
      const flightOnly = aggregate(baseMap, { flight: true, cruise: false }, 2024);
      expect(flightOnly.countriesCount).toBe(2); // DE, US
    });

    it("returns 0 for a year the domain has no countries for", () => {
      const result = aggregate(baseMap, { flight: true, cruise: true }, 1999);
      expect(result.countriesCount).toBe(0);
    });

    it("falls back to the lifetime set when a domain predates the year index", () => {
      // A domain adapter that has not been taught countriesByYear yet must
      // not silently contribute zero — that would UNDER-report the count
      // rather than over-report it, which is the harder bug to notice.
      const legacy: DomainStatsMap = {
        flight: { ...flightStats, countriesByYear: undefined },
      };
      const result = aggregate(legacy, { flight: true }, 2024);
      expect(result.countriesCount).toBe(3); // DE, US, JP — the lifetime set
    });
  });

  it("year-scoped activeDays sum yearlyActiveDays per domain (no double-count)", () => {
    const result = aggregate(baseMap, { flight: true, cruise: true }, 2024);
    expect(result.activeDays).toBe(20);
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
