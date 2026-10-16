import { buildPassport, type PassportFlight } from "../passport";

import { roadtripEvidence } from "../roadtripEvidence";

/**
 * Owner decision 2026-10-16: forgejo#299 asked for ONE thing — location
 * history must not make a country count. The chain redesign that came with it
 * (dd22d0bf6) also stopped counting open-jaw trips, one-way ends, the home
 * country and port calls, and was reverted. These pin the restored rule.
 */
const now = new Date("2026-10-14T12:00:00Z");
const countries = new Map([
  ["MUC", "DE"],
  ["DOH", "QA"],
  ["HAN", "VN"],
  ["SGN", "VN"],
  ["BKK", "TH"],
  ["PNH", "KH"],
]);
const flight = (depIata: string, arrIata: string, day: string): PassportFlight => ({
  depIata,
  arrIata,
  depLat: 0,
  depLon: 0,
  arrLat: 0,
  arrLon: 0,
  departureTime: new Date(`${day}T12:00:00Z`),
  localDay: day,
  status: "flown",
});
const chain = [
  flight("MUC", "DOH", "2025-01-01"),
  flight("DOH", "HAN", "2025-01-02"),
  flight("HAN", "DOH", "2025-01-20"),
  flight("DOH", "MUC", "2025-01-21"),
];
const sameDayHub = [
  flight("MUC", "DOH", "2025-01-01"),
  flight("DOH", "HAN", "2025-01-01"),
  flight("HAN", "DOH", "2025-01-20"),
  flight("DOH", "MUC", "2025-01-20"),
];

describe("country counting after forgejo#299", () => {
  it("counts the home country and both ends of an open-jaw trip", () => {
    // MUC→BKK out, PNH→MUC home: overland between Thailand and Cambodia, which
    // no flight records. dd22d0bf6 filed both foreign ends as `connection` and
    // the trip counted no country at all.
    const result = buildPassport(
      [flight("MUC", "BKK", "2025-02-01"), flight("PNH", "MUC", "2025-02-20")],
      countries,
      ["MUC"],
      now
    );
    expect(result.countries.map((c) => [c.code, c.counted]).sort()).toEqual([
      ["DE", true],
      ["KH", true],
      ["TH", true],
    ]);
    expect(result.countries.find((c) => c.code === "DE")?.isHome).toBe(true);
    expect(result.summary).toMatchObject({ countries: 3, countriesTotal: 3 });
  });

  it("counts the destination and an overnight hub, as a night on the ground", () => {
    const result = buildPassport(chain, countries, [], now);
    expect(result.countries.find((c) => c.code === "QA")?.tier).toBe("slept");
    expect(result.summary).toMatchObject({ groundCountries: 3, visitedCountries: 3, countries: 3 });
  });

  it("leaves a same-day hub connection uncounted, and marks it uncertain", () => {
    const result = buildPassport(sameDayHub, countries, [], now);
    expect(result.countries.find((c) => c.code === "QA")).toMatchObject({
      tier: "connection",
      counted: false,
      visited: false,
      groundPresence: true,
      visitUncertain: true,
    });
    expect(result.summary).toMatchObject({ countries: 2, countriesTotal: 3 });
  });

  it("lets a recorded place in the hub country count it", () => {
    const result = buildPassport(
      sameDayHub,
      countries,
      [],
      now,
      [],
      [{ isoCountryCode: "QA", at: null }]
    );
    expect(result.summary.countries).toBe(3);
  });

  it("does not upgrade a connection with a place or stay the user marked as transit", () => {
    const result = buildPassport(
      sameDayHub,
      countries,
      [],
      now,
      [],
      [{ isoCountryCode: "QA", at: null, countryVisitKind: "transit" }],
      [{ isoCountryCode: "QA", stays: [], countryVisitKind: "transit" }]
    );
    expect(result.countries.find((c) => c.code === "QA")?.counted).toBe(false);
  });

  it("preserves transit classification for a stay linked to a roadtrip", () => {
    expect(
      roadtripEvidence([
        {
          country: "QA",
          night: true,
          at: now,
          days: ["2026-10-14"],
          countryVisitKind: "transit",
        },
      ])[0].tier
    ).toBe("transited");
  });

  it("keeps an undated recorded visit and never invents its date", () => {
    const result = buildPassport([], countries, [], now, [], [{ isoCountryCode: "BE", at: null }]);
    expect(result.countries[0]).toMatchObject({
      code: "BE",
      counted: true,
      firstYear: null,
      hasUndatedEvidence: true,
    });
  });

  it("counts every country of a multi-stop trip", () => {
    const result = buildPassport(
      [chain[0], chain[1], flight("HAN", "BKK", "2025-01-20")],
      countries,
      [],
      now
    );
    expect(result.countries.map((c) => c.code).sort()).toEqual(["DE", "QA", "TH", "VN"]);
    expect(result.summary.countries).toBe(4);
  });

  it("honours the threshold it is given", () => {
    const strict = buildPassport(
      [flight("MUC", "BKK", "2025-02-01"), flight("BKK", "MUC", "2025-02-20")],
      countries,
      ["MUC"],
      now,
      [],
      [],
      [],
      "slept"
    );
    expect(strict.summary.countryThreshold).toBe("slept");
    // Thailand spans nights between the two flights; Germany's two ends are
    // one-way ends, `visited` only.
    expect(strict.countries.map((c) => [c.code, c.counted]).sort()).toEqual([
      ["DE", false],
      ["TH", true],
    ]);
    expect(strict.summary.countries).toBe(1);
  });

  it("does not count future or cancelled journeys", () => {
    const result = buildPassport(
      [flight("MUC", "HAN", "2099-01-01"), { ...chain[0], status: "cancelled" }],
      countries,
      [],
      now
    );
    expect(result.summary).toMatchObject({ groundCountries: 0, visitedCountries: 0 });
  });
});
