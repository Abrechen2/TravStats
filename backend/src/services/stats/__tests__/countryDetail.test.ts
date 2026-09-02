import {
  buildCountryDetail,
  type CountryDetailFlight,
  type CountryDetailLodging,
} from "../countryDetail";

/**
 * Forgejo #42: the country page is derived once, on the server.
 *
 * The Companion derives it in `countryDetailFromFlights`, which is a second
 * implementation of the rules `passport.ts` states. These tests pin the places
 * where the two could quietly answer differently — the domestic leg, the
 * cruise-only country, the undated row — because on a one-way, flights-only
 * account every plausible rule gives the same answer and nothing would show.
 */
const flight = (
  id: string,
  dep: string,
  arr: string,
  over: Partial<CountryDetailFlight> = {}
): CountryDetailFlight => ({
  id,
  flightNumber: "LH123",
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

describe("buildCountryDetail", () => {
  it("counts a domestic leg as ONE entry and TWO airport visits", () => {
    // The rule that separates "how often was I there" from "which airports did
    // I use". Getting it wrong doubles the entry count of anyone who flies
    // inside their own country, and the passport row would then disagree.
    const detail = buildCountryDetail("DE", [flight("a", "MUC", "FRA")], countries);

    expect(detail?.entries).toBe(1);
    expect(detail?.airports).toEqual([
      { iata: "FRA", visits: 1, firstDate: "2024-04-12" },
      { iata: "MUC", visits: 1, firstDate: "2024-04-12" },
    ]);
    expect(detail?.timeline).toHaveLength(1);
  });

  it("counts both ends, so a country flown only FROM still appears", () => {
    const detail = buildCountryDetail("US", [flight("a", "JFK", "FRA")], countries);
    expect(detail?.entries).toBe(1);
    expect(detail?.evidence).toBe("flight");
  });

  it("names the arrival as the anchoring airport of a leg that lands here", () => {
    const detail = buildCountryDetail("DE", [flight("a", "JFK", "FRA")], countries);
    expect(detail?.timeline[0]).toMatchObject({
      kind: "flight",
      airportIata: "FRA",
      depIata: "JFK",
      arrIata: "FRA",
    });
  });

  it("ignores a booked flight", () => {
    // Same cut the passport and every other statistic make: a booking is not a
    // visit. With nothing else to show, the country is unknown rather than
    // present-but-empty.
    const detail = buildCountryDetail(
      "DE",
      [flight("a", "MUC", "FRA", { status: "scheduled" })],
      countries
    );
    expect(detail).toBeNull();
  });

  it("returns a country reached only by a cruise, with no entries and no airports", () => {
    // The reason this is not a 404: the passport lists such a row, and it is
    // clickable. A page that refused to open would be the very disagreement
    // between list and detail that #42 was filed about.
    const detail = buildCountryDetail(
      "IT",
      [flight("a", "MUC", "FRA")],
      countries,
      [],
      [
        {
          cruiseId: "c1",
          portName: "Genova",
          country: "Italy",
          at: new Date("2023-07-04T00:00:00Z"),
        },
      ]
    );

    expect(detail?.evidence).toBe("port");
    expect(detail?.entries).toBe(0);
    expect(detail?.airports).toEqual([]);
    expect(detail?.portCalls).toBe(1);
    expect(detail?.firstYear).toBe(2023);
    expect(detail?.anchor).toBeNull();
    expect(detail?.timeline[0]).toMatchObject({ kind: "port", portName: "Genova", cruiseId: "c1" });
  });

  it("opens a port stored under its NATIVE country name, not only its English one", () => {
    // The port catalogue's `country` is free text, so it holds "Italia" beside
    // "Italy" and "Deutschland" beside "Germany". The passport folds it through
    // BOTH resolvers; this file once used the English-only table alone. The
    // result was a row that counted the country and a panel that could not name
    // the record which counted it — the list and the detail disagreeing, which
    // is the whole defect forgejo#42 was filed about, reappearing one layer down.
    const detail = buildCountryDetail(
      "IT",
      [flight("a", "MUC", "FRA")],
      countries,
      [],
      [{ cruiseId: "c1", portName: "Genova", country: "Italia", at: new Date("2023-07-04T00:00:00Z") }]
    );

    expect(detail?.portCalls).toBe(1);
    expect(detail?.timeline[0]).toMatchObject({ kind: "port", portName: "Genova" });
  });

  it("reports the STRONGEST evidence when several kinds apply", () => {
    const detail = buildCountryDetail(
      "DE",
      [flight("a", "MUC", "FRA")],
      countries,
      [],
      [{ cruiseId: "c1", portName: "Hamburg", country: "Germany", at: null }],
      [{ placeId: "p1", name: "Zugspitze", isoCountryCode: "de", at: null }]
    );

    expect(detail?.evidence).toBe("flight");
    // Counted all the same — the strongest kind names the row, it does not
    // hide the rest.
    expect(detail?.portCalls).toBe(1);
    expect(detail?.places).toBe(1);
    expect(detail?.timeline).toHaveLength(3);
  });

  it("opens a country proved ONLY by a house, and names the house it can be edited from", () => {
    // The motivating case of the whole design, and until now the one this page
    // could not serve: a lodging-only country answered 404, so the drill-down
    // for `Hotel Sport` — one house, no stay, a Place ID saying Bucharest while
    // its address says Otočec in Slovenia — opened on nothing. The owner's
    // instruction is that the record must be reachable AND changeable, which
    // needs the id, not the count.
    const detail = buildCountryDetail(
      "SI",
      [],
      countries,
      [],
      [],
      [],
      [{ lodgingId: "l1", name: "Hotel Sport", isoCountryCode: "SI", stays: [] }]
    );

    expect(detail).not.toBeNull();
    expect(detail?.code).toBe("SI");
    expect(detail?.evidence).toBe("lodging");
    expect(detail?.lodgings).toBe(1);
    expect(detail?.timeline).toEqual([
      { kind: "lodging", date: null, lodgingId: "l1", name: "Hotel Sport" },
    ]);
    // The honesty the passport already keeps: a house is not an airport and not
    // a flight, so a country proved by one shows neither.
    expect(detail?.entries).toBe(0);
    expect(detail?.airports).toEqual([]);
  });

  it("dates a lodging row from the stay that proved it", () => {
    const detail = buildCountryDetail(
      "CZ",
      [],
      countries,
      [],
      [],
      [],
      [
        {
          lodgingId: "l2",
          name: "Pension Praha",
          isoCountryCode: "cz",
          stays: [
            {
              status: "completed",
              checkIn: new Date("2019-08-01T00:00:00Z"),
              checkOut: new Date("2019-08-04T00:00:00Z"),
            },
          ],
        },
      ]
    );

    expect(detail?.timeline[0]).toMatchObject({
      kind: "lodging",
      lodgingId: "l2",
      date: "2019-08-04",
    });
    expect(detail?.firstYear).toBe(2019);
  });

  it("does not open a country whose only house is a future booking or a cancellation", () => {
    // `lodgingEvidence` owns this cut and is not second-guessed here — if it
    // were, the page could show a house the passport row does not count, which
    // is the disagreement between list and detail that #42 is about.
    const booking: CountryDetailLodging = {
      lodgingId: "l3",
      name: "Hotel Bukarest",
      isoCountryCode: "RO",
      stays: [{ status: "confirmed", checkIn: null, checkOut: new Date("2099-12-24T00:00:00Z") }],
    };
    const cancelled: CountryDetailLodging = {
      lodgingId: "l4",
      name: "Hotel Bukarest",
      isoCountryCode: "RO",
      stays: [
        { status: "cancelled", checkIn: null, checkOut: new Date("2019-05-04T00:00:00Z") },
      ],
    };

    expect(buildCountryDetail("RO", [], countries, [], [], [], [booking])).toBeNull();
    expect(buildCountryDetail("RO", [], countries, [], [], [], [cancelled])).toBeNull();
  });

  it("keeps the flight as the label when a house and a flight both apply", () => {
    const detail = buildCountryDetail(
      "DE",
      [flight("a", "MUC", "FRA")],
      countries,
      [],
      [],
      [],
      [{ lodgingId: "l5", name: "Hotel München", isoCountryCode: "DE", stays: [] }]
    );

    expect(detail?.evidence).toBe("flight");
    expect(detail?.lodgings).toBe(1);
    expect(detail?.timeline).toHaveLength(2);
  });

  it("skips a place whose country was never resolved", () => {
    // shared/placeCounting.ts makes the same cut for the same reason: a guess
    // would file a place under a country nobody can check by looking.
    const detail = buildCountryDetail(
      "IT",
      [],
      new Map(),
      [],
      [],
      [{ placeId: "p1", name: "somewhere", isoCountryCode: null, at: null }]
    );
    expect(detail).toBeNull();
  });

  it("skips an airport whose country the catalogue does not know", () => {
    const detail = buildCountryDetail("DE", [flight("a", "MUC", "XXX")], countries);
    expect(detail?.airports.map((a) => a.iata)).toEqual(["MUC"]);
  });

  it("accepts an English country name as well as a code", () => {
    expect(buildCountryDetail("Germany", [flight("a", "MUC", "FRA")], countries)?.code).toBe("DE");
    expect(buildCountryDetail("de", [flight("a", "MUC", "FRA")], countries)?.code).toBe("DE");
  });

  it("returns null for a code the catalogue does not know", () => {
    expect(buildCountryDetail("ZZ", [flight("a", "MUC", "FRA")], countries)).toBeNull();
    expect(buildCountryDetail("", [flight("a", "MUC", "FRA")], countries)).toBeNull();
  });

  it("anchors on the busiest airport that carries coordinates", () => {
    const detail = buildCountryDetail(
      "DE",
      [flight("a", "MUC", "FRA"), flight("b", "JFK", "FRA")],
      countries
    );
    expect(detail?.anchor).toEqual({ iata: "FRA", lat: 50.03, lon: 8.57 });
  });

  it("puts the newest row first and an undated one last", () => {
    // An undated visit is still a visit — dropping it would lose the row, and
    // sorting it as if it were the epoch would put it above nothing.
    const detail = buildCountryDetail(
      "DE",
      [
        flight("old", "MUC", "FRA", { departureTime: new Date("2019-01-01T00:00:00Z") }),
        flight("new", "MUC", "FRA", { departureTime: new Date("2024-04-12T08:00:00Z") }),
        flight("undated", "MUC", "FRA", { departureTime: null }),
      ],
      countries
    );

    expect(detail?.timeline.map((e) => (e.kind === "flight" ? e.flightId : null))).toEqual([
      "new",
      "old",
      "undated",
    ]);
    expect(detail?.firstYear).toBe(2019);
    expect(detail?.lastYear).toBe(2024);
  });

  it("marks a home airport's country as home", () => {
    const detail = buildCountryDetail("DE", [flight("a", "MUC", "FRA")], countries, ["muc"]);
    expect(detail?.isHome).toBe(true);
    expect(buildCountryDetail("US", [flight("a", "JFK", "FRA")], countries, ["muc"])?.isHome).toBe(
      false
    );
  });

  it("caps the timeline and says that it did", () => {
    const many = Array.from({ length: 5 }, (_, i) => flight(`f${i}`, "MUC", "FRA"));
    const detail = buildCountryDetail("DE", many, countries, [], [], [], [], 2);

    expect(detail?.timeline).toHaveLength(2);
    expect(detail?.timelineTruncated).toBe(true);
    // The counts are of everything, not of what fitted — a page that shows two
    // rows out of five must still be able to say "five".
    expect(detail?.entries).toBe(5);
  });
});
