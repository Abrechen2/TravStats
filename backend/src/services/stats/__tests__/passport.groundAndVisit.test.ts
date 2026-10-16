import { buildPassport, type PassportFlight } from "../passport";

import { roadtripEvidence } from "../roadtripEvidence";

const now = new Date("2026-10-14T12:00:00Z");
const countries = new Map([
  ["MUC", "DE"],
  ["DOH", "QA"],
  ["HAN", "VN"],
  ["SGN", "VN"],
  ["BKK", "TH"],
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

describe("forgejo#299: ground presence and actual visits", () => {
  it("counts a return destination without a hotel, but not overnight hub connections", () => {
    const result = buildPassport(chain, countries, [], now);
    expect(result.summary).toMatchObject({ groundCountries: 3, visitedCountries: 1, countries: 1 });
    expect(result.countries.find((c) => c.code === "VN")).toMatchObject({ visited: true });
    expect(result.countries.find((c) => c.code === "QA")).toMatchObject({
      visited: false,
      groundPresence: true,
      visitUncertain: true,
    });
  });

  it("lets a confirmed city stop prove a visit in the hub country", () => {
    const result = buildPassport(
      chain,
      countries,
      [],
      now,
      [],
      [{ isoCountryCode: "QA", at: null }]
    );
    expect(result.summary.visitedCountries).toBe(2);
  });

  it("does not upgrade an airport restaurant or an airside overnight", () => {
    const result = buildPassport(
      chain,
      countries,
      [],
      now,
      [],
      [{ isoCountryCode: "QA", at: null, countryVisitKind: "transit" }],
      [{ isoCountryCode: "QA", stays: [], countryVisitKind: "transit" }]
    );
    expect(result.countries.find((c) => c.code === "QA")?.visited).toBe(false);
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

  it("dates a new visit from its visit evidence, not an earlier transit", () => {
    const result = buildPassport(
      chain,
      countries,
      [],
      now,
      [],
      [{ isoCountryCode: "QA", at: new Date("2026-03-01T12:00:00Z") }]
    );
    expect(result.countries.find((c) => c.code === "QA")).toMatchObject({
      firstYear: 2025,
      firstVisitedYear: 2026,
      isNew: true,
    });
    expect(result.summary.newThisYear).toBe(1);
  });

  it("does not invent a first visit year when an undated visit also exists", () => {
    const result = buildPassport(
      [],
      countries,
      [],
      now,
      [],
      [
        { isoCountryCode: "BE", at: null },
        { isoCountryCode: "BE", at: new Date("2026-03-01T12:00:00Z") },
      ]
    );
    expect(result.countries[0]).toMatchObject({
      visited: true,
      firstVisitedYear: null,
      isNew: false,
    });
  });

  it("keeps an undated confirmed work visit and never invents its date", () => {
    const result = buildPassport([], countries, [], now, [], [{ isoCountryCode: "BE", at: null }]);
    expect(result.countries[0]).toMatchObject({
      code: "BE",
      visited: true,
      firstYear: null,
      hasUndatedEvidence: true,
    });
  });

  it("handles domestic legs within the destination as one return spell", () => {
    const result = buildPassport(
      [
        chain[0],
        chain[1],
        flight("HAN", "SGN", "2025-01-10"),
        flight("SGN", "DOH", "2025-01-20"),
        chain[3],
      ],
      countries,
      [],
      now
    );
    expect(result.countries.find((c) => c.code === "VN")?.visited).toBe(true);
    expect(result.countries.find((c) => c.code === "QA")?.visited).toBe(false);
  });

  it("does not call an ambiguous onward chain a visit even across many nights", () => {
    const result = buildPassport(
      [chain[0], chain[1], flight("HAN", "BKK", "2025-01-20")],
      countries,
      [],
      now
    );
    expect(result.summary.visitedCountries).toBe(0);
    expect(result.summary.groundCountries).toBe(4);
  });

  it("does not count future or cancelled journeys and ignores legacy threshold settings", () => {
    const result = buildPassport(
      [flight("MUC", "HAN", "2099-01-01"), { ...chain[0], status: "cancelled" }],
      countries,
      [],
      now,
      [],
      [],
      [],
      "connection"
    );
    expect(result.summary).toMatchObject({ groundCountries: 0, visitedCountries: 0 });
  });
});
