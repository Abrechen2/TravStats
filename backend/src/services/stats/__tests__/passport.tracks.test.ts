/**
 * A country nobody logged — spec §8, and the reason the `transited` rung exists.
 *
 * TravStats stores curated events: a flight, a cruise, a house. Driving across
 * a border is none of those, which is why Estonia and Lithuania were absent
 * from the owner's passport while Latvia survived only because there happened
 * to be a house in it. What these pin is that measured presence raises a
 * country, that it raises it at the RIGHT rung, and that it never overrules a
 * record that says something stronger.
 */
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

describe("measured presence raises a country nobody logged", () => {
  it("puts a country in the passport on track evidence alone", () => {
    const p = withTracks([day("2024-06-01", "LV"), day("2024-06-01", "EE")]);

    const ee = p.countries.find((c) => c.code === "EE");
    expect(ee).toBeDefined();
    expect(ee?.kinds).toEqual(["track"]);
    expect(ee?.evidence).toBe("track");
    expect(ee?.daysPresent).toBe(1);
  });

  it("counts a road crossing in the headline, at the default threshold", () => {
    // The Baltic question, answered. §3.4c: only `connection` is excluded by
    // default, so driving through counts — folding it into `connection` would
    // have answered the owner's question wrongly.
    const p = withTracks([day("2024-06-01", "LV"), day("2024-06-01", "EE")]);

    expect(p.countries.find((c) => c.code === "EE")?.tier).toBe("transited");
    expect(p.countries.find((c) => c.code === "EE")?.counted).toBe(true);
    expect(p.summary.byTier.transited).toBe(2);
    expect(p.summary.countries).toBe(2);
  });

  it("adds no airport, no entry and no stamp", () => {
    // A track is not a flight. Same honesty a house already gets.
    const p = withTracks([day("2024-06-01", "EE")]);

    expect(p.summary.airports).toBe(0);
    expect(p.summary.entries).toBe(0);
    expect(p.stamps).toEqual([]);
    expect(p.countries.find((c) => c.code === "EE")?.groundTime).toEqual({
      state: "notApplicable",
    });
  });

  it("counts the distinct days it recorded, and never the gap between them", () => {
    const p = withTracks([
      day("2024-06-01", "EE"),
      day("2024-06-02", "EE"),
      day("2024-08-01", "EE"),
    ]);

    expect(p.countries.find((c) => c.code === "EE")?.daysPresent).toBe(3);
  });
});

describe("a track never overrules a stronger record", () => {
  it("leaves a country proved by a house at `slept`", () => {
    // Strongest wins, and a house is the strongest proof there is. A single
    // track day must not pull Latvia down to `transited`.
    const p = withTracks([day("2024-06-01", "LV"), day("2024-06-01", "EE")], [house("LV")]);

    const lv = p.countries.find((c) => c.code === "LV");
    expect(lv?.tier).toBe("slept");
    expect(lv?.kinds).toEqual(["lodging", "track"]);
    // The LABEL stays the record a reader can open. `track` takes the bottom
    // rung of `EVIDENCE_RANK` precisely so nothing already correct is
    // relabelled when location history arrives.
    expect(lv?.evidence).toBe("lodging");
  });

  it("does not let a connection's own GPS trail promote it", () => {
    // §8.2 end to end: MUC → DOH → SIN is a connection, and the points in
    // Qatar all sat at the airport it flew through. The passport must still
    // read Qatar as a connection, and still leave it out of the headline.
    const p = buildPassport(
      [flight("MUC", "DOH", "2024-03-01"), flight("DOH", "SIN", "2024-03-01")],
      AIRPORTS,
      [],
      NOW,
      [],
      [],
      [],
      undefined,
      [day("2024-03-01", "QA", { pointCount: 30, airportPointCount: 30 })]
    );

    const qa = p.countries.find((c) => c.code === "QA");
    expect(qa?.tier).toBe("connection");
    expect(qa?.counted).toBe(false);
    // …and it is still in the list, which is the whole point of `counted`.
    expect(p.summary.countriesTotal).toBe(3);
  });

  it("promotes the same connection once the traveller left the airport", () => {
    // One fix in the city is the difference between "changed planes" and
    // "spent the day in Doha", and it is the only difference the data holds.
    const p = buildPassport(
      [flight("MUC", "DOH", "2024-03-01"), flight("DOH", "SIN", "2024-03-01")],
      AIRPORTS,
      [],
      NOW,
      [],
      [],
      [],
      undefined,
      [day("2024-03-01", "QA", { pointCount: 30, airportPointCount: 29 })]
    );

    const qa = p.countries.find((c) => c.code === "QA");
    // The day is shared with Germany and Singapore in reality, but the track
    // recorded only Qatar — so it was a day this country had to itself.
    expect(qa?.tier).toBe("visited");
    expect(qa?.counted).toBe(true);
  });
});

describe("the threshold still moves nothing but the headline", () => {
  it("keeps every track country in the list at the strictest setting", () => {
    const rows = [day("2024-06-01", "LV"), day("2024-06-01", "EE")];
    const strict = buildPassport([], AIRPORTS, [], NOW, [], [], [], "slept", rows);

    expect(strict.summary.countriesTotal).toBe(2);
    expect(strict.summary.countries).toBe(0);
    expect(strict.countries.every((c) => c.counted === false)).toBe(true);
  });
});
