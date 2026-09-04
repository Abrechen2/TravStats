import { buildPassport, type PassportFlight } from "../passport";

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

/**
 * Country-counting design §5: every user's count moves with this feature, and
 * the UI says so once — "vorher 32 Länder, jetzt 35". The "vorher" is the rule
 * that held before: a country counted when a flown flight touched one of its
 * airports, whichever end. That number is still computable, so it travels
 * with the passport instead of being guessed on the client.
 */
describe("the passport carries the number the old rule would give", () => {
  it("equals the headline when only flights are given", () => {
    const passport = buildPassport([flight("MUC", "JFK")], countries);
    expect(passport.summary.legacyCountries).toBe(2);
    expect(passport.summary.countries).toBe(2);
  });

  it("leaves out a country proved only by a port call or a house — the old rule never saw those", () => {
    const passport = buildPassport(
      [flight("MUC", "FRA")],
      countries,
      [],
      new Date("2024-06-01T00:00:00Z"),
      [{ country: "Italy", at: new Date("2023-07-04T00:00:00Z") }],
    );
    expect(passport.summary.countries).toBe(2);
    expect(passport.summary.legacyCountries).toBe(1);
  });

  it("still counts a country the new rule only transits — the old rule counted every airport touched", () => {
    // A connection in the US on the way somewhere: below the default
    // threshold today, but the old count credited the airport.
    const passport = buildPassport(
      [
        flight("MUC", "JFK", { arrivalTime: new Date("2024-04-12T14:00:00Z") }),
        flight("JFK", "FRA", {
          depLat: 40.64,
          depLon: -73.78,
          departureTime: new Date("2024-04-12T16:00:00Z"),
        }),
      ],
      countries,
      [],
      new Date("2024-06-01T00:00:00Z"),
      [],
      [],
      [],
      "visited",
    );
    const us = passport.countries.find((c) => c.code === "US");
    expect(us).toBeDefined();
    expect(passport.summary.legacyCountries).toBe(2);
  });
});
