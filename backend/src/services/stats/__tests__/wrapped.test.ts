import { buildWrapped, type WrappedFlight } from "../wrapped";

/**
 * Forgejo #42, the last of the four pieces: the year in review is derived on
 * the server.
 *
 * Ported from the Companion's `wrappedFromServer`. The tests below pin the two
 * places where this deliberately answers differently from it — the undirected
 * top route and the evidence-based country count — because both are invisible
 * on a simple account and would otherwise be "fixed" back by the next reader.
 */
const flight = (over: Partial<WrappedFlight> = {}): WrappedFlight => ({
  depIata: "MUC",
  arrIata: "FRA",
  departureTime: new Date("2024-04-12T08:00:00Z"),
  airline: "Lufthansa",
  flightNumber: "LH123",
  status: "flown",
  distanceKm: 300,
  ...over,
});

describe("buildWrapped", () => {
  it("returns null when there is nothing to look back on", () => {
    expect(buildWrapped([], [], [])).toBeNull();
    // A booking is not a memory.
    expect(buildWrapped([flight({ status: "scheduled" })], [], [])).toBeNull();
  });

  it("takes the year from the data, not the wall clock", () => {
    // Rule 1. Reading the clock would make the same account tell a different
    // story on 31 December and 1 January, which is not a property a
    // year-in-review may have.
    const wrapped = buildWrapped(
      [
        flight({ departureTime: new Date("2019-06-01T00:00:00Z") }),
        flight({ departureTime: new Date("2022-06-01T00:00:00Z") }),
      ],
      [],
      []
    );

    expect(wrapped?.year).toBe(2022);
    expect(wrapped?.availableYears).toEqual([2019, 2022]);
  });

  it("honours a requested year, even an empty one", () => {
    // The user asked about 2019. "You flew nothing in 2019" is a true answer;
    // quietly showing 2022 instead is not.
    const wrapped = buildWrapped(
      [flight({ departureTime: new Date("2022-06-01T00:00:00Z") })],
      [],
      [],
      2019
    );

    expect(wrapped?.year).toBe(2019);
    expect(wrapped?.flights).toBe(0);
    expect(wrapped?.topAirline).toBeNull();
    expect(wrapped?.topRoute).toBeNull();
  });

  it("ranks exactly: top, second with the year named, other otherwise", () => {
    // Rule 2. 'second' is what lets the copy name the year that beat it, so it
    // must mean exactly one year did — never "roughly near the top".
    const year = (y: number, count: number): WrappedFlight[] =>
      Array.from({ length: count }, () =>
        flight({ departureTime: new Date(`${y}-06-01T00:00:00Z`) })
      );

    expect(buildWrapped(year(2024, 5), [], [])?.rank).toBe("top");

    const second = buildWrapped([...year(2023, 9), ...year(2024, 5)], [], []);
    expect(second?.rank).toBe("second");
    expect(second?.comparisonYear).toBe(2023);

    const other = buildWrapped([...year(2022, 9), ...year(2023, 8), ...year(2024, 5)], [], []);
    expect(other?.rank).toBe("other");
    expect(other?.comparisonYear).toBeNull();
  });

  it("does not crown a flightless year as the best flying year", () => {
    // A cruise-only year beats no year on flights, so the naive reading of
    // rule 2 makes it 'top' and the story opens by calling it a record.
    const wrapped = buildWrapped([], [{ startDate: new Date("2024-05-01"), status: "flown" }], []);
    expect(wrapped?.year).toBe(2024);
    expect(wrapped?.cruises).toBe(1);
    expect(wrapped?.rank).toBe("other");
    expect(wrapped?.comparisonYear).toBeNull();
  });

  it("groups the top route by the PAIR, not the direction", () => {
    // The departure from the Companion, and the same rule /stats/routes
    // follows. A wrapped story that ranked directions would contradict the
    // top-routes list on the same account.
    const wrapped = buildWrapped(
      [
        flight({ depIata: "MUC", arrIata: "DXB" }),
        flight({ depIata: "DXB", arrIata: "MUC" }),
        flight({ depIata: "MUC", arrIata: "FRA" }),
      ],
      [],
      []
    );

    expect(wrapped?.topRoute).toEqual({ from: "DXB", to: "MUC", flights: 2 });
  });

  it("counts new countries as the passport does, not as the flights do", () => {
    // The second departure. `countries` comes from buildPassport, so a country
    // first reached by cruise counts here exactly as it does on the passport.
    const wrapped = buildWrapped(
      [flight()],
      [],
      [
        { firstYear: 2024, counted: true },
        { firstYear: 2024, counted: true },
        { firstYear: 2019, counted: true },
        { firstYear: null, counted: true },
      ]
    );
    expect(wrapped?.newCountries).toBe(2);
  });

  it("leaves out a country the user's threshold does not count", () => {
    // A country first reached in 2024 but proved only by a connection. The
    // passport greys the row and does not count it; the story must not open
    // with a new country the headline beside it denies (spec §3.2).
    const wrapped = buildWrapped(
      [flight()],
      [],
      [
        { firstYear: 2024, counted: true },
        { firstYear: 2024, counted: false },
      ]
    );
    expect(wrapped?.newCountries).toBe(1);
  });

  it("names the year's most-flown carrier and takes its code from the number", () => {
    const wrapped = buildWrapped(
      [
        flight({ airline: "Lufthansa", flightNumber: "LH123" }),
        flight({ airline: "Lufthansa", flightNumber: "LH456" }),
        flight({ airline: "Condor", flightNumber: "DE 22" }),
      ],
      [],
      []
    );

    expect(wrapped?.topAirline).toEqual({ name: "Lufthansa", code: "LH", flights: 2 });
  });

  it("omits a favourite the year cannot support rather than inventing one", () => {
    // Rule 3, the same abstention records.ts makes. A null tells the story to
    // skip that page; a zero would draw an empty one.
    const wrapped = buildWrapped(
      [flight({ airline: null, flightNumber: null, depIata: null, arrIata: null })],
      [],
      []
    );

    expect(wrapped?.flights).toBe(1);
    expect(wrapped?.topAirline).toBeNull();
    expect(wrapped?.topRoute).toBeNull();
  });

  it("keeps an airline whose flight number carries no usable code", () => {
    // The name is the identity; the code only decorates a tile. Dropping the
    // carrier because its number is unusual would lose the bigger fact.
    const wrapped = buildWrapped([flight({ airline: "Some Air", flightNumber: "9999" })], [], []);
    expect(wrapped?.topAirline).toEqual({ name: "Some Air", code: null, flights: 1 });
  });

  it("sums the year's distance and reports it in trips around the Earth", () => {
    const wrapped = buildWrapped(
      [
        flight({ distanceKm: 20000 }),
        flight({ distanceKm: 20037.5 }),
        flight({ distanceKm: 100, departureTime: new Date("2019-06-01T00:00:00Z") }),
      ],
      [],
      []
    );

    expect(wrapped?.distanceKm).toBe(40038);
    expect(wrapped?.earthFactor).toBe(1);
  });

  it("counts only sailed cruises, in the year they started", () => {
    const wrapped = buildWrapped(
      [flight()],
      [
        { startDate: new Date("2024-05-01"), status: "flown" },
        { startDate: new Date("2024-09-01"), status: "scheduled" },
        { startDate: new Date("2019-05-01"), status: "historical" },
      ],
      []
    );

    expect(wrapped?.cruises).toBe(1);
    expect(wrapped?.availableYears).toEqual([2019, 2024]);
  });
});
