import { buildPassport } from "../passport";
import { buildCountryDetail } from "../countryDetail";
import type { CountryDayRow } from "../trackEvidence";

const NOW = new Date("2026-10-13T12:00:00Z");
const day = (date: string, countryCode: string, pointCount = 1): CountryDayRow => ({
  date,
  countryCode,
  pointCount,
  airportPointCount: 0,
  partialWindow: false,
});

describe("forgejo#299: unverified locations are not ground presence", () => {
  it.each(["connection", "transited", "visited", "slept"] as const)(
    "does not count a single overflight point at threshold %s",
    (threshold) => {
      const p = buildPassport([], new Map(), [], NOW, [], [], [], threshold, [
        day("2024-06-01", "SY"),
      ]);
      expect(p.summary.countries).toBe(0);
      expect(p.summary.countriesTotal).toBe(0);
      expect(p.summary.continentsVisited).toBe(0);
      expect(p.countries).toEqual([]);
      expect(p.unconfirmedCountries).toEqual([
        {
          code: "SY",
          source: "dawarich",
          reason: "ground-unconfirmed",
          observedDays: 1,
          pointCount: 1,
          firstDate: "2024-06-01",
          lastDate: "2024-06-01",
        },
      ]);
    }
  );

  it("does not promote many points, consecutive days or shared border days", () => {
    const p = buildPassport([], new Map(), [], NOW, [], [], [], undefined, [
      day("2024-06-01", "SY", 1000),
      day("2024-06-02", "SY", 1000),
      day("2024-06-02", "LB", 1000),
    ]);
    expect(p.summary.countries).toBe(0);
    expect(p.summary.newThisYear).toBe(0);
    expect(p.unconfirmedCountries).toHaveLength(2);
  });

  it("preserves an undated confirmed visit without inventing a date from tracks", () => {
    const p = buildPassport(
      [],
      new Map(),
      [],
      NOW,
      [],
      [{ isoCountryCode: "BE", at: null }],
      [],
      undefined,
      [day("2024-06-01", "BE")]
    );
    expect(p.summary.countries).toBe(1);
    expect(p.countries[0]).toMatchObject({
      code: "BE",
      kinds: ["place"],
      tier: "visited",
      daysPresent: 0,
      firstYear: null,
      lastYear: null,
      hasUndatedEvidence: true,
    });
  });

  it("does not widen a confirmed visit's years in the country detail", () => {
    const detail = buildCountryDetail(
      "DE",
      [],
      new Map(),
      [],
      [],
      [
        {
          placeId: "place-1",
          name: "City visit",
          isoCountryCode: "DE",
          at: new Date("2023-06-01T00:00:00Z"),
        },
      ],
      [],
      [day("2020-06-01", "DE"), day("2025-06-01", "DE")]
    );
    expect(detail).toMatchObject({ firstYear: 2023, lastYear: 2023 });
    expect(detail?.timeline).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "track", days: 2, points: 2 })])
    );
  });
});
