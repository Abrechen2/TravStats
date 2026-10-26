/**
 * `buildPassport(..., year)` — companion-redesign C4. What the route tests
 * cannot see cheaply: a trip over New Year, which the chain grades on all its
 * legs before the year is cut, and a stay over New Year.
 */
import { describe, it, expect } from "@jest/globals";

import { buildPassport, type PassportFlight } from "../passport";

const COUNTRIES = new Map<string, string | null>([
  ["MUC", "DE"],
  ["BKK", "TH"],
]);

const flight = (dep: string, arr: string, day: string): PassportFlight => ({
  depIata: dep,
  depLat: 0,
  depLon: 0,
  arrIata: arr,
  arrLat: 0,
  arrLon: 0,
  departureTime: new Date(`${day}T10:00:00Z`),
  status: "flown",
  localDay: day,
});

const NOW = new Date("2026-10-25T00:00:00Z");
const TRIP = [flight("MUC", "BKK", "2023-12-28"), flight("BKK", "MUC", "2024-01-04")];

const build = (year?: number, lodgings: Parameters<typeof buildPassport>[6] = []) =>
  buildPassport(TRIP, COUNTRIES, [], NOW, [], [], lodgings, undefined, [], [], [], "UTC", [], [], [], year); // prettier-ignore

const row = (p: ReturnType<typeof buildPassport>, code: string) =>
  p.countries.find((c) => c.code === code);

describe("buildPassport — scoped to one year", () => {
  it("keeps a New Year trip's destination VISITED in both years it touches", () => {
    expect(row(build(), "TH")).toMatchObject({ visited: true, firstYear: 2023, lastYear: 2024 });
    // Cut the legs first and each year would see an open chain: unclear, not visited.
    expect(row(build(2023), "TH")).toMatchObject({ visited: true, firstYear: 2023, entries: 1 });
    expect(row(build(2024), "TH")).toMatchObject({ visited: true, lastYear: 2024, entries: 1 });
    expect(build(2022).countries).toEqual([]);
  });

  it("agrees with the lifetime row's visitSources years", () => {
    const years = row(build(), "TH")!.visitSources.flatMap((s) => s.years);
    for (const year of [2022, 2023, 2024, 2025]) {
      expect(row(build(year), "TH") !== undefined).toBe(years.includes(year));
    }
  });

  it("reads 'new' as first visited in the scoped year", () => {
    expect(row(build(2023), "TH")?.isNew).toBe(true);
    expect(row(build(2024), "TH")?.isNew).toBe(false);
    expect(row(build(2023), "TH")?.firstVisitedYear).toBe(2023);
  });

  it("files a stay by the days it covers and leaves an undated house out", () => {
    const lodgings = [
      {
        isoCountryCode: "AT",
        stays: [
          {
            status: "completed",
            checkIn: new Date("2022-12-30T00:00:00Z"),
            checkOut: new Date("2023-01-02T00:00:00Z"),
          },
        ],
      },
      { isoCountryCode: "CZ", stays: [] },
    ];
    expect(row(build(2022, lodgings), "AT")?.daysPresent).toBe(2);
    expect(row(build(2023, lodgings), "AT")?.daysPresent).toBe(2);
    expect(row(build(undefined, lodgings), "CZ")).toBeDefined();
    for (const year of [2022, 2023]) expect(row(build(year, lodgings), "CZ")).toBeUndefined();
  });
});
