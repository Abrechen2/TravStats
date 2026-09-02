import { buildPassport, type PassportFlight } from "../passport";

/**
 * Forgejo #42, owner's decision 2026-08-31: the passport counts EVIDENCE, not
 * only landings.
 *
 * The Companion already counted this way — "31 geflogen · 5 per hafen · 2
 * anders erreicht" — while this server counted flights alone, so one account
 * had two answers to "how many countries". These tests pin the parts that make
 * the two agree, and the abstentions that keep the number honest.
 */
const flight = (dep: string, arr: string, over: Partial<PassportFlight> = {}): PassportFlight => ({
  depIata: dep,
  depLat: 48.35,
  depLon: 11.78,
  arrIata: arr,
  arrLat: 50.03,
  arrLon: 8.57,
  departureTime: new Date("2024-04-12T08:00:00Z"),
  status: "flown",
  ...over,
});

const countries = new Map([
  ["MUC", "Germany"],
  ["FRA", "Germany"],
  ["JFK", "United States"],
]);

describe("the passport counts evidence", () => {
  it("still answers exactly as before when only flights are given", () => {
    // The two new arguments are optional so every existing caller — and every
    // existing account — keeps its number until evidence is actually passed.
    const passport = buildPassport([flight("MUC", "FRA")], countries);
    expect(passport.summary.countries).toBe(1);
    // `lodging` joined the split on 2026-09-02 (a house is evidence too). The
    // three figures that existed before it are untouched, which is the point of
    // asserting the whole object rather than three keys of it.
    expect(passport.summary.byEvidence).toEqual({ flight: 1, port: 0, place: 0, lodging: 0, track: 0 });
  });

  it("adds a country reached only by a port call", () => {
    const passport = buildPassport(
      [flight("MUC", "FRA")],
      countries,
      [],
      new Date("2024-06-01T00:00:00Z"),
      [{ country: "Italy", at: new Date("2023-07-04T00:00:00Z") }]
    );

    expect(passport.summary.countries).toBe(2);
    expect(passport.summary.byEvidence).toEqual({ flight: 1, port: 1, place: 0, lodging: 0, track: 0 });
    const italy = passport.countries.find((c) => c.code === "IT");
    expect(italy?.evidence).toBe("port");
    // A port call is not a flight and not an airport, so it inflates neither.
    // A country proved only this way honestly shows nothing for either.
    expect(italy?.entries).toBe(0);
    expect(italy?.airports).toEqual([]);
    expect(italy?.firstYear).toBe(2023);
  });

  it("adds a country reached only by a recorded place", () => {
    const passport = buildPassport(
      [flight("MUC", "FRA")],
      countries,
      [],
      new Date("2024-06-01T00:00:00Z"),
      [],
      [{ isoCountryCode: "pt", at: new Date("2022-05-01T00:00:00Z") }]
    );

    expect(passport.summary.byEvidence).toEqual({ flight: 1, port: 0, place: 1, lodging: 0, track: 0 });
    // Lower-cased in the source, upper-cased in the answer: the code is the
    // join key and two spellings of it must not become two countries.
    expect(passport.countries.find((c) => c.code === "PT")?.evidence).toBe("place");
  });

  it("gives a country its strongest evidence when several apply", () => {
    // A landing outranks a port call, which outranks a recorded place. Without
    // this the split line would double-count: a country you flew to AND sailed
    // to would appear under both.
    const passport = buildPassport(
      [flight("MUC", "JFK")],
      countries,
      [],
      new Date("2024-06-01T00:00:00Z"),
      [{ country: "United States", at: new Date("2023-01-01T00:00:00Z") }],
      [{ isoCountryCode: "US", at: new Date("2023-01-02T00:00:00Z") }]
    );

    const us = passport.countries.find((c) => c.code === "US");
    expect(us?.evidence).toBe("flight");
    expect(passport.summary.byEvidence.flight).toBe(2);
    expect(passport.summary.byEvidence.port).toBe(0);
    expect(passport.summary.byEvidence.place).toBe(0);
  });

  it("the split always sums to the country count", () => {
    const passport = buildPassport(
      [flight("MUC", "JFK")],
      countries,
      [],
      new Date("2024-06-01T00:00:00Z"),
      [{ country: "Italy", at: null }],
      [{ isoCountryCode: "PT", at: null }]
    );

    const { flight: f, port, place } = passport.summary.byEvidence;
    expect(f + port + place).toBe(passport.summary.countries);
  });

  it("ignores a place whose country was never resolved", () => {
    // Never a guess. `shared/placeCounting.ts` makes the same cut for the same
    // reason: a wrong country inflates a continent quota invisibly.
    const passport = buildPassport(
      [flight("MUC", "FRA")],
      countries,
      [],
      new Date("2024-06-01T00:00:00Z"),
      [],
      [{ isoCountryCode: null, at: new Date("2022-05-01T00:00:00Z") }]
    );

    expect(passport.summary.countries).toBe(1);
    expect(passport.summary.byEvidence.place).toBe(0);
  });

  it("ignores a port whose country the catalogue does not name", () => {
    const passport = buildPassport(
      [flight("MUC", "FRA")],
      countries,
      [],
      new Date("2024-06-01T00:00:00Z"),
      [
        { country: null, at: null },
        { country: "   ", at: null },
      ]
    );

    expect(passport.summary.countries).toBe(1);
  });

  it("counts a country first reached this year as new, whatever proved it", () => {
    // The flight is dated an earlier year on purpose: with both in 2024 the
    // assertion below would pass for the wrong reason, since Germany would be
    // new too. The point is that a PORT-proved country counts as new.
    const passport = buildPassport(
      [flight("MUC", "FRA", { departureTime: new Date("2019-04-12T08:00:00Z") })],
      countries,
      [],
      new Date("2024-06-01T00:00:00Z"),
      [{ country: "Italy", at: new Date("2024-03-01T00:00:00Z") }]
    );

    expect(passport.countries.find((c) => c.code === "IT")?.isNew).toBe(true);
    expect(passport.summary.newThisYear).toBe(1);
  });
});
