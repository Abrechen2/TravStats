import { crossDomainDayKey, dayKeyInYear, foldCrossDomain } from "../crossDomainCounting";

/**
 * The backend half of the mirror's truth table. `frontend/src/shared/
 * __tests__/crossDomainCounting.test.ts` asserts the same facts about the
 * same rules — the convention in this codebase, since nothing checks that
 * the two files are byte-identical.
 *
 * Each case is one of the three additions the KPI strip makes, and each is a
 * different addition: events add, countries union, days union on the key.
 */
describe("foldCrossDomain", () => {
  it("adds events, and keeps the per-domain breakdown the subtitle renders", () => {
    const totals = foldCrossDomain([
      { domain: "flight", events: 12, countries: [], activeDayKeys: [] },
      { domain: "cruise", events: 2, countries: [], activeDayKeys: [] },
    ]);
    expect(totals.totalEvents).toBe(14);
    expect(totals.perDomainEvents).toEqual({ flight: 12, cruise: 2 });
  });

  it("counts a country reached by two domains ONCE", () => {
    // The whole reason this is a union: flying to Germany and sleeping in
    // Germany is one country, and summing the two sets would say two.
    const totals = foldCrossDomain([
      { domain: "flight", events: 1, countries: ["DE", "FR"], activeDayKeys: [] },
      { domain: "lodging", events: 1, countries: ["DE"], activeDayKeys: [] },
    ]);
    expect(totals.countriesCount).toBe(2);
  });

  it("counts a day two domains were both active on ONCE", () => {
    const totals = foldCrossDomain([
      { domain: "flight", events: 1, countries: [], activeDayKeys: ["2025-06-01", "2025-06-02"] },
      { domain: "lodging", events: 1, countries: [], activeDayKeys: ["2025-06-02"] },
    ]);
    expect(totals.activeDays).toBe(2);
  });

  /**
   * A domain that cannot name its days hands over a tally, which is ADDED.
   * That over-reports where it shares a day with a domain that can — the
   * stated trade, because under-reporting a KPI is the harder one to spot.
   */
  it("adds a tally from a domain with no day index, rather than dropping it", () => {
    const totals = foldCrossDomain([
      { domain: "flight", events: 1, countries: [], activeDayKeys: ["2025-06-02"] },
      {
        domain: "poi",
        events: 3,
        countries: [],
        activeDayKeys: [],
        activeDaysWithoutIndex: 4,
      },
    ]);
    expect(totals.activeDays).toBe(5);
  });

  it("answers zero for no visible domains at all, rather than throwing", () => {
    expect(foldCrossDomain([])).toEqual({
      totalEvents: 0,
      perDomainEvents: {},
      countriesCount: 0,
      activeDays: 0,
    });
  });
});

describe("crossDomainDayKey", () => {
  it("pads month and day so the key sorts and prefix-matches", () => {
    expect(crossDomainDayKey(2025, 6, 1)).toBe("2025-06-01");
  });
});

describe("dayKeyInYear", () => {
  it("keeps every day when no year is selected", () => {
    expect(dayKeyInYear("2019-01-01", null)).toBe(true);
  });

  it("matches on the KEY's own year, not on a re-read of the date", () => {
    expect(dayKeyInYear("2025-12-31", 2025)).toBe(true);
    expect(dayKeyInYear("2026-01-01", 2025)).toBe(false);
  });
});
