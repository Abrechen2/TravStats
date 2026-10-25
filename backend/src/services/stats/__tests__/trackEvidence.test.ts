import { unconfirmedTrackCountries, type CountryDayRow } from "../trackEvidence";

const NOW = new Date("2026-10-13T12:00:00Z");
const day = (
  date: string,
  countryCode: string,
  over: Partial<CountryDayRow> = {}
): CountryDayRow => ({
  date,
  countryCode,
  pointCount: 20,
  airportPointCount: 0,
  partialWindow: false,
  ...over,
});

describe("unconfirmed location observations (forgejo#299)", () => {
  it("summarises distinct observed days and points, never a tier or presence days", () => {
    const rows = [day("2024-06-05", "EE"), day("2024-06-01", "EE"), day("2024-06-01", "ee")];
    expect(unconfirmedTrackCountries(rows, NOW)).toEqual([
      {
        code: "EE",
        source: "dawarich",
        reason: "ground-unconfirmed",
        observedDays: 2,
        pointCount: 60,
        firstDate: "2024-06-01",
        lastDate: "2024-06-05",
      },
    ]);
  });

  it.each([
    { pointCount: 1 },
    { pointCount: 10000 },
    { airportPointCount: 20 },
    { airportPointCount: 19 },
    { partialWindow: true },
  ])("does not infer ground presence from aggregate properties: %j", (over) => {
    const rows = [day("2024-06-01", "QA", over), day("2024-06-02", "QA", over)];
    expect(unconfirmedTrackCountries(rows, NOW)[0]).toMatchObject({ reason: "ground-unconfirmed" });
    expect(unconfirmedTrackCountries(rows, NOW)[0]).not.toHaveProperty("tier");
  });

  it("sorts country codes and does not expand gaps into dates", () => {
    const rows = [day("2024-08-01", "LV"), day("2024-06-01", "EE"), day("2024-06-01", "LV")];
    expect(unconfirmedTrackCountries(rows, NOW).map((r) => [r.code, r.observedDays])).toEqual([
      ["EE", 1],
      ["LV", 2],
    ]);
  });

  it("ignores unknown countries, invalid dates, future observations and empty rows", () => {
    const rows = [
      day("2024-06-01", "ZZ"),
      day("not-a-day", "DE"),
      day("2024-02-30", "DE"),
      day("2026-10-14", "DE"),
      day("2024-06-01", "DE", { pointCount: 0 }),
      day("2024-06-01", "DE", { pointCount: NaN }),
    ];
    expect(unconfirmedTrackCountries(rows, NOW)).toEqual([]);
    expect(unconfirmedTrackCountries([], NOW)).toEqual([]);
    expect(unconfirmedTrackCountries([day("2026-10-13", "DE")], NOW)).toHaveLength(1);
  });

  it("keeps TravTrack's observations apart from Dawarich's, one entry per source (TravTrack plan E6)", () => {
    const rows = [
      day("2024-06-01", "EE", { source: "dawarich" }),
      day("2024-06-02", "EE", { source: "travtrack", pointCount: 5 }),
      day("2024-06-03", "EE", { source: "travtrack", pointCount: 7 }),
      // A source this build does not know is not guessed into one it does.
      day("2024-06-04", "EE", { source: "gps" }),
    ];
    expect(unconfirmedTrackCountries(rows, NOW)).toEqual([
      expect.objectContaining({ code: "EE", source: "dawarich", observedDays: 1, pointCount: 20 }),
      expect.objectContaining({
        code: "EE",
        source: "travtrack",
        observedDays: 2,
        pointCount: 12,
        firstDate: "2024-06-02",
        lastDate: "2024-06-03",
      }),
    ]);
  });

  it("reads a row without a source as Dawarich's, as every row was before TravTrack", () => {
    expect(unconfirmedTrackCountries([day("2024-06-01", "EE")], NOW)[0].source).toBe("dawarich");
  });
});
