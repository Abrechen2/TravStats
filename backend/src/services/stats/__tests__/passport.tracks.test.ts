import { buildPassport, type PassportFlight, type PassportLodging } from "../passport";
import type { CountryDayRow } from "../trackEvidence";

const AIRPORTS = new Map<string, string | null>([
  ["MUC", "DE"],
  ["DOH", "QA"],
  ["SIN", "SG"],
]);

const NOW = new Date("2026-09-02T12:00:00Z");

const flight = (dep: string, arr: string, localDay: string): PassportFlight => ({
  depIata: dep,
  depLat: 0,
  depLon: 0,
  arrIata: arr,
  arrLat: 0,
  arrLon: 0,
  departureTime: new Date(`${localDay}T08:00:00Z`),
  localDay,
  status: "flown",
});

const day = (
  date: string,
  countryCode: string,
  overrides: Partial<CountryDayRow> = {}
): CountryDayRow => ({
  date,
  countryCode,
  pointCount: 20,
  airportPointCount: 0,
  partialWindow: false,
  ...overrides,
});

const house = (code: string): PassportLodging => ({ isoCountryCode: code, stays: [] });

const withTracks = (rows: CountryDayRow[], lodgings: PassportLodging[] = []) =>
  buildPassport([], AIRPORTS, [], NOW, [], [], lodgings, undefined, rows);

describe("location observations stay outside country evidence (forgejo#299)", () => {
  it("does not count any country, continent, visit day, year or stamp from tracks alone", () => {
    const p = withTracks([day("2024-06-01", "LV"), day("2024-06-01", "EE")]);
    expect(p.countries).toEqual([]);
    expect(p.summary).toMatchObject({
      countries: 0,
      countriesTotal: 0,
      airports: 0,
      entries: 0,
      continentsVisited: 0,
      firstStampYear: null,
      newThisYear: 0,
    });
    expect(p.stamps).toEqual([]);
    expect(p.unconfirmedCountries.map((r) => r.code)).toEqual(["EE", "LV"]);
  });

  it("keeps an undated house counted without adding track days or years to it", () => {
    const p = withTracks([day("2024-06-01", "LV"), day("2024-06-01", "EE")], [house("LV")]);
    expect(p.summary.countries).toBe(1);
    expect(p.countries[0]).toMatchObject({
      code: "LV",
      tier: "slept",
      kinds: ["lodging"],
      daysPresent: 0,
      firstYear: null,
      lastYear: null,
      hasUndatedEvidence: true,
    });
    expect(p.unconfirmedCountries).toHaveLength(2);
  });

  it.each([0, 29, 30])(
    "does not promote a connection from %s airport points",
    (airportPointCount) => {
      const p = buildPassport(
        [flight("MUC", "DOH", "2024-03-01"), flight("DOH", "SIN", "2024-03-01")],
        AIRPORTS,
        [],
        NOW,
        [],
        [],
        [],
        undefined,
        [day("2024-03-01", "QA", { pointCount: 30, airportPointCount })]
      );
      expect(p.countries.find((c) => c.code === "QA")).toMatchObject({
        tier: "connection",
        counted: false,
        kinds: ["flight"],
      });
      expect(p.summary.countriesTotal).toBe(3);
      expect(p.unconfirmedCountries[0].code).toBe("QA");
    }
  );

  it("a confirmed city visit still promotes a connection", () => {
    const p = buildPassport(
      [flight("MUC", "DOH", "2024-03-01"), flight("DOH", "SIN", "2024-03-01")],
      AIRPORTS,
      [],
      NOW,
      [],
      [{ isoCountryCode: "QA", at: new Date("2024-03-01T12:00:00Z") }],
      [],
      undefined,
      [day("2024-03-01", "QA")]
    );
    expect(p.countries.find((c) => c.code === "QA")).toMatchObject({
      tier: "visited",
      counted: true,
      kinds: ["flight", "place"],
    });
  });

  it("does not widen a dated visit using unrelated observations", () => {
    const p = buildPassport(
      [],
      AIRPORTS,
      [],
      NOW,
      [],
      [{ isoCountryCode: "DE", at: new Date("2023-06-01T00:00:00Z") }],
      [],
      undefined,
      [day("2020-06-01", "DE"), day("2025-06-01", "DE")]
    );
    expect(p.countries[0]).toMatchObject({ firstYear: 2023, lastYear: 2023, daysPresent: 1 });
    expect(p.unconfirmedCountries[0]).toMatchObject({
      firstDate: "2020-06-01",
      lastDate: "2025-06-01",
    });
  });
});
