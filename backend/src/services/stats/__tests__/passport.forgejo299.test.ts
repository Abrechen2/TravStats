import { buildPassport, type PassportFlight } from "../passport";

/**
 * The acceptance list of forgejo#299 (owner, 2026-10-13) plus the owner's
 * rulings of 2026-10-16, one test per rule. Every title names the rule and
 * every test asserts both numbers for the country it is about:
 * "Am Boden gewesen" (`groundPresence`, every row) and "Land besucht"
 * (`visited`). An undecidable chain is a third answer, `visitUncertain` with
 * its reason, never a silent drop and never an invented visit.
 */

const NOW = new Date("2026-10-16T12:00:00Z");
const AIRPORTS = new Map<string, string | null>([
  ["MUC", "DE"],
  ["FRA", "DE"],
  ["DOH", "QA"],
  ["HAN", "VN"],
  ["SGN", "VN"],
  ["BKK", "TH"],
  ["PNH", "KH"],
  ["JFK", "US"],
]);

const flight = (dep: string, arr: string, day: string, status = "flown"): PassportFlight => ({
  depIata: dep,
  arrIata: arr,
  depLat: 0,
  depLon: 0,
  arrLat: 0,
  arrLon: 0,
  departureTime: new Date(`${day}T10:00:00Z`),
  localDay: day,
  status,
});

/** buildPassport with only the arguments a case needs, by name. */
const passport = (
  over: {
    flights?: PassportFlight[];
    ports?: Parameters<typeof buildPassport>[4];
    places?: Parameters<typeof buildPassport>[5];
    lodgings?: Parameters<typeof buildPassport>[6];
    tracks?: Parameters<typeof buildPassport>[8];
    stations?: Parameters<typeof buildPassport>[9];
    homeCountries?: string[];
  } = {}
) =>
  buildPassport(
    over.flights ?? [],
    AIRPORTS,
    [],
    NOW,
    over.ports ?? [],
    over.places ?? [],
    over.lodgings ?? [],
    undefined,
    over.tracks ?? [],
    over.stations ?? [],
    [],
    "UTC",
    [],
    over.homeCountries ?? []
  );

const row = (p: ReturnType<typeof buildPassport>, code: string) =>
  p.countries.find((c) => c.code === code);

/** MUC -> DOH -> HAN and back, a night in the Doha terminal each way. */
const DOHA_HANOI = [
  flight("MUC", "DOH", "2025-01-01"),
  flight("DOH", "HAN", "2025-01-02"),
  flight("HAN", "DOH", "2025-01-20"),
  flight("DOH", "MUC", "2025-01-21"),
];

describe("forgejo#299 acceptance: ground presence vs. visit", () => {
  it("an overflight or outlier location point counts in neither set", () => {
    const p = passport({
      tracks: [
        {
          date: "2026-09-10",
          countryCode: "SY",
          pointCount: 1,
          airportPointCount: 0,
          partialWindow: false,
        },
      ],
    });

    expect(row(p, "SY")).toBeUndefined();
    expect(p.summary).toMatchObject({ groundCountries: 0, visitedCountries: 0 });
    // Still visible as an observation, so the user can see why it does not count.
    expect(p.unconfirmedCountries.map((c) => c.code)).toEqual(["SY"]);
  });

  it("a night connection in the terminal is ground presence only, and decided", () => {
    const p = passport({ flights: DOHA_HANOI });

    expect(row(p, "QA")).toMatchObject({
      groundPresence: true,
      visited: false,
      // The chain is decidable: Vietnam is the turnaround, Qatar the hub.
      visitUncertain: false,
      visitUncertainReasons: [],
    });
  });

  it("a night in an airport hotel marked as transit does not lift the hub", () => {
    const p = passport({
      flights: DOHA_HANOI,
      lodgings: [{ isoCountryCode: "QA", countryVisitKind: "transit", stays: [] }],
    });

    expect(row(p, "QA")).toMatchObject({ groundPresence: true, visited: false });
  });

  it("a drive-through or a rest stop on a roadtrip is ground presence only", () => {
    const p = passport({
      stations: [{ country: "AT", night: false, at: NOW, days: ["2026-08-01"] }],
      places: [{ isoCountryCode: "CH", at: null, countryVisitKind: "transit" }],
    });

    expect(row(p, "AT")).toMatchObject({ groundPresence: true, visited: false });
    expect(row(p, "CH")).toMatchObject({ groundPresence: true, visited: false });
  });

  it("a place in the service-area category is ground presence only, without the manual flag", () => {
    // Criterion 9: the kind of place decides. A restaurant at a motorway
    // service area is not a visit of the country, so the category carries
    // the transit verdict on its own.
    const p = passport({
      places: [{ isoCountryCode: "AT", at: new Date("2026-08-01"), category: "service_area" }],
    });

    expect(row(p, "AT")).toMatchObject({ groundPresence: true, visited: false });
  });

  it("a confirmed place visit is a visit", () => {
    const p = passport({ places: [{ isoCountryCode: "ES", at: new Date("2024-05-01") }] });

    expect(row(p, "ES")).toMatchObject({ groundPresence: true, visited: true });
  });

  it("an undated confirmed visit is a visit and keeps no invented date", () => {
    const p = passport({ places: [{ isoCountryCode: "BE", at: null }] });

    expect(row(p, "BE")).toMatchObject({
      visited: true,
      firstYear: null,
      firstVisitedYear: null,
      hasUndatedEvidence: true,
    });
  });

  it("an outbound and a return flight at the destination prove a visit without a hotel", () => {
    const p = passport({
      flights: [flight("MUC", "JFK", "2024-03-01"), flight("JFK", "MUC", "2024-03-09")],
    });

    expect(row(p, "US")).toMatchObject({ groundPresence: true, visited: true });
  });

  it("MUC -> DOH -> HAN and back: Vietnam visited, Qatar ground only", () => {
    const p = passport({ flights: DOHA_HANOI });

    expect(row(p, "VN")).toMatchObject({ groundPresence: true, visited: true });
    expect(row(p, "QA")).toMatchObject({ groundPresence: true, visited: false });
  });

  it("cancelled and future journeys count in neither set", () => {
    const p = passport({
      flights: [
        flight("MUC", "HAN", "2099-01-01"),
        flight("MUC", "JFK", "2024-01-01", "cancelled"),
      ],
      places: [{ isoCountryCode: "PT", at: new Date("2099-06-01") }],
    });

    expect(p.countries).toEqual([]);
    expect(p.summary).toMatchObject({ groundCountries: 0, visitedCountries: 0 });
  });
});

describe("forgejo#299: an undecidable chain is shown as unclear, never dropped", () => {
  it("an open-jaw trip (MUC -> BKK, PNH -> MUC) keeps both ends as unclear ground presence", () => {
    const p = passport({
      flights: [flight("MUC", "BKK", "2024-02-01"), flight("PNH", "MUC", "2024-02-20")],
      homeCountries: ["DE"],
    });

    for (const code of ["TH", "KH"]) {
      expect(row(p, code)).toMatchObject({
        groundPresence: true,
        visited: false,
        visitUncertain: true,
        visitUncertainReasons: ["openChain"],
      });
    }
    expect(p.summary.unclearCountries).toBe(2);
  });

  it("a one-way trip leaves its end unclear rather than calling it a connection", () => {
    const p = passport({ flights: [flight("MUC", "BKK", "2024-02-01")], homeCountries: ["DE"] });

    expect(row(p, "TH")).toMatchObject({
      visited: false,
      visitUncertain: true,
      visitUncertainReasons: ["openChain"],
    });
  });

  it("a round trip with two possible destinations and no turnaround is unclear for both", () => {
    // MUC -> BKK -> SGN -> MUC: either country could have been the stay; no
    // time threshold may pick one (forgejo#299).
    const p = passport({
      flights: [
        flight("MUC", "BKK", "2024-02-01"),
        flight("BKK", "SGN", "2024-02-10"),
        flight("SGN", "MUC", "2024-02-20"),
      ],
      homeCountries: ["DE"],
    });

    for (const code of ["TH", "VN"]) {
      expect(row(p, code)).toMatchObject({
        visited: false,
        visitUncertain: true,
        visitUncertainReasons: ["noDestination"],
      });
    }
  });

  it("a recorded stay resolves an unclear country into a visit", () => {
    const p = passport({
      flights: [flight("MUC", "BKK", "2024-02-01"), flight("PNH", "MUC", "2024-02-20")],
      places: [{ isoCountryCode: "TH", at: new Date("2024-02-05") }],
      homeCountries: ["DE"],
    });

    expect(row(p, "TH")).toMatchObject({ visited: true, visitUncertain: false });
    expect(row(p, "KH")).toMatchObject({ visited: false, visitUncertain: true });
  });
});

describe("forgejo#299: the home country", () => {
  it("counts the home country as visited even when every flight there is a chain end", () => {
    // Living somewhere is the longest stay there is; the owner's comparison
    // figures list Germany among the visited countries.
    const p = passport({
      flights: [flight("MUC", "BKK", "2024-02-01"), flight("PNH", "MUC", "2024-02-20")],
      homeCountries: ["DE"],
    });

    expect(row(p, "DE")).toMatchObject({
      groundPresence: true,
      visited: true,
      isHome: true,
      visitUncertain: false,
    });
  });

  it("does not create a home-country row out of nothing but the setting", () => {
    // A row needs a record to open; a home with no travel record proves the
    // setting, not a trip, and the lists only ever show evidence.
    const p = passport({ homeCountries: ["DE"] });

    expect(p.countries).toEqual([]);
  });

  it("without a home period the same chain ends stay unclear ground presence", () => {
    const p = passport({
      flights: [flight("MUC", "BKK", "2024-02-01"), flight("PNH", "MUC", "2024-02-20")],
    });

    expect(row(p, "DE")).toMatchObject({ visited: false, visitUncertain: true });
  });
});

describe("owner ruling 2026-10-16: a port call is a visit", () => {
  it("a port day counts as visited ('Landgang ist eindeutig ein Besuch')", () => {
    const p = passport({
      ports: [{ country: "Italy", at: new Date("2023-07-04T08:00:00Z") }],
    });

    expect(row(p, "IT")).toMatchObject({ groundPresence: true, visited: true, tier: "visited" });
  });

  it("a cruise-only account counts its port countries", () => {
    const p = passport({
      ports: [
        { country: "Norway", at: new Date("2023-07-04T08:00:00Z") },
        { country: "Denmark", at: new Date("2023-07-06T08:00:00Z") },
      ],
    });

    expect(p.summary).toMatchObject({ groundCountries: 2, visitedCountries: 2, countries: 2 });
  });
});

describe("forgejo#299: per-domain visit sources for the overview tile", () => {
  it("names only the domains whose records prove the visit, with their years", () => {
    const p = passport({
      flights: DOHA_HANOI,
      places: [{ isoCountryCode: "BE", at: null }],
      lodgings: [
        {
          isoCountryCode: "VN",
          stays: [
            {
              status: "completed",
              checkIn: new Date("2025-01-03T00:00:00Z"),
              checkOut: new Date("2025-01-05T00:00:00Z"),
            },
          ],
        },
      ],
    });

    expect(row(p, "VN")?.visitSources).toEqual([
      { domain: "flight", years: [2025], undated: false },
      { domain: "lodging", years: [2025], undated: false },
    ]);
    // Qatar is ground presence: no domain proves a visit there.
    expect(row(p, "QA")?.visitSources).toEqual([]);
    // An undated place proves the visit for the lifetime figure only.
    expect(row(p, "BE")?.visitSources).toEqual([{ domain: "poi", years: [], undated: true }]);
  });

  it("leaves out a domain whose records there are ground presence only", () => {
    // Qatar is visited through a city walk; the flights only connected there,
    // so the flight chip alone must not show Qatar as visited.
    const p = passport({
      flights: DOHA_HANOI,
      places: [{ isoCountryCode: "QA", at: new Date("2025-01-21T12:00:00Z") }],
    });

    expect(row(p, "QA")?.visitSources).toEqual([{ domain: "poi", years: [2025], undated: false }]);
  });

  it("lets every record of a lifted home country stand for its visit", () => {
    const p = passport({
      flights: [flight("MUC", "BKK", "2024-02-01"), flight("PNH", "MUC", "2024-02-20")],
      homeCountries: ["DE"],
    });

    expect(row(p, "DE")?.visitSources).toEqual([
      { domain: "flight", years: [2024], undated: false },
    ]);
  });

  it("files a port call under the cruise domain", () => {
    const p = passport({ ports: [{ country: "Norway", at: new Date("2023-07-04T08:00:00Z") }] });

    expect(row(p, "NO")?.visitSources).toEqual([
      { domain: "cruise", years: [2023], undated: false },
    ]);
  });
});
