import { buildPassport, type PassportFlight, type PassportLodging } from "../passport";
import { buildCountryDetail } from "../countryDetail";
import { lodgingStamp } from "../lodgingStamp";

/**
 * forgejo#78 + forgejo#93 — a passport row counts the OTHER evidence behind it.
 *
 * `entries` and `airports` said it for flights; a row proved by a cruise or a
 * house said nothing about how much. These tests pin three things: that the
 * row's `portCalls`/`places` are the SAME numbers the drill-down reports (one
 * predicate, `./evidenceCountry.ts`), that the lodging stamp counts only what
 * the stays can prove, and that a country with no house carries `null`.
 */
const NOW = new Date("2024-06-01T00:00:00Z");

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
]);

const stay = (
  checkIn: string | null,
  checkOut: string | null,
  over: Partial<PassportLodging["stays"][number]> = {}
) => ({
  status: "completed",
  checkIn: checkIn ? new Date(checkIn) : null,
  checkOut: checkOut ? new Date(checkOut) : null,
  ...over,
});

describe("passport rows count port calls and places (forgejo#78)", () => {
  const portCalls = [
    { country: "Italy", at: new Date("2023-07-04T00:00:00Z") },
    { country: "Italy", at: new Date("2023-07-06T00:00:00Z") },
    // The catalogue's own spelling — resolves through the same predicate the
    // drill-down uses, so it lands on DE and not on a row of its own.
    { country: "Deutschland", at: new Date("2023-07-08T00:00:00Z") },
  ];
  const placeVisits = [
    { isoCountryCode: "it", at: new Date("2023-07-05T00:00:00Z") },
    { isoCountryCode: null, at: new Date("2023-07-05T00:00:00Z") },
  ];

  it("reports the counts per row, and zero where a kind is absent", () => {
    const passport = buildPassport(
      [flight("MUC", "FRA")],
      countries,
      [],
      NOW,
      portCalls,
      placeVisits
    );

    const italy = passport.countries.find((c) => c.code === "IT");
    expect(italy?.portCalls).toBe(2);
    expect(italy?.places).toBe(1);

    const germany = passport.countries.find((c) => c.code === "DE");
    expect(germany?.portCalls).toBe(1);
    expect(germany?.places).toBe(0);
    expect(germany?.lodging).toBeNull();
  });

  it("agrees with the drill-down, which counts with the same predicate", () => {
    const passport = buildPassport(
      [flight("MUC", "FRA")],
      countries,
      [],
      NOW,
      portCalls,
      placeVisits
    );
    const detail = buildCountryDetail(
      "IT",
      [],
      countries,
      [],
      portCalls.map((call, i) => ({ cruiseId: `c${i}`, portName: null, ...call })),
      placeVisits.map((visit, i) => ({ placeId: `p${i}`, name: `Place ${i}`, ...visit }))
    );

    const italy = passport.countries.find((c) => c.code === "IT");
    expect(detail?.portCalls).toBe(italy?.portCalls);
    expect(detail?.places).toBe(italy?.places);
  });
});

describe("the lodging stamp (forgejo#93)", () => {
  it("sums the nights of stays that happened and names the town with the most", () => {
    const lodgings: PassportLodging[] = [
      {
        isoCountryCode: "AT",
        city: "Wien",
        stays: [stay("2023-03-01T00:00:00Z", "2023-03-05T00:00:00Z")], // 4 nights
      },
      {
        isoCountryCode: "AT",
        city: "Salzburg",
        stays: [
          stay("2023-08-10T00:00:00Z", "2023-08-12T00:00:00Z"), // 2 nights
          stay("2022-08-10T00:00:00Z", "2022-08-11T00:00:00Z"), // 1 night
        ],
      },
    ];
    const passport = buildPassport([], new Map(), [], NOW, [], [], lodgings);

    const austria = passport.countries.find((c) => c.code === "AT");
    expect(austria?.lodging).toEqual({ place: "Wien", nights: 7 });
    expect(austria?.kinds).toEqual(["lodging"]);
  });

  it("is null for a country no house proves", () => {
    const passport = buildPassport([flight("MUC", "FRA")], countries, [], NOW);
    expect(passport.countries.find((c) => c.code === "DE")?.lodging).toBeNull();
  });

  it("does not let a future booking or a cancelled stay count a night", () => {
    const lodgings: PassportLodging[] = [
      {
        isoCountryCode: "ES",
        city: "Madrid",
        stays: [
          stay("2023-03-01T00:00:00Z", "2023-03-03T00:00:00Z"), // 2 nights, happened
          stay("2024-09-01T00:00:00Z", "2024-09-08T00:00:00Z"), // still ahead
          stay("2023-05-01T00:00:00Z", "2023-05-08T00:00:00Z", { status: "cancelled" }),
        ],
      },
    ];
    expect(lodgingStamp(lodgings, NOW)).toEqual({ place: "Madrid", nights: 2 });
  });

  it("proves no nights for a stay without a usable span, and none for a house with no stay", () => {
    // A month-precision stay is stored as the 1st; the span between two
    // placeholders is fiction, so `nightsKnown` is false and nothing is added.
    const monthOnly: PassportLodging = {
      isoCountryCode: "PT",
      city: "Porto",
      stays: [stay("2023-07-01T00:00:00Z", "2023-07-01T00:00:00Z", { datePrecision: "MONTH" })],
    };
    expect(lodgingStamp([monthOnly], NOW)).toEqual({ place: "Porto", nights: null });

    // …unless the record says how long in words: an explicit night count is
    // what the field exists for.
    const monthWithNights: PassportLodging = {
      ...monthOnly,
      stays: [
        stay("2023-07-01T00:00:00Z", "2023-07-01T00:00:00Z", { datePrecision: "MONTH", nights: 3 }),
      ],
    };
    expect(lodgingStamp([monthWithNights], NOW)).toEqual({ place: "Porto", nights: 3 });

    // A house with NO stay is evidence (owner's decision) but proves no night —
    // null, never 0: a zero would claim zero nights.
    const undated: PassportLodging = { isoCountryCode: "PT", city: "Lisboa", stays: [] };
    expect(lodgingStamp([undated], NOW)).toEqual({ place: "Lisboa", nights: null });
  });

  it("names the next house that has a town when the busiest has none", () => {
    const lodgings: PassportLodging[] = [
      {
        isoCountryCode: "FR",
        city: null,
        stays: [stay("2023-01-01T00:00:00Z", "2023-01-06T00:00:00Z")],
      },
      {
        isoCountryCode: "FR",
        city: "Lyon",
        stays: [stay("2023-02-01T00:00:00Z", "2023-02-02T00:00:00Z")],
      },
    ];
    expect(lodgingStamp(lodgings, NOW)).toEqual({ place: "Lyon", nights: 6 });

    const nameless: PassportLodging[] = [
      {
        isoCountryCode: "FR",
        city: null,
        stays: [stay("2023-01-01T00:00:00Z", "2023-01-06T00:00:00Z")],
      },
    ];
    expect(lodgingStamp(nameless, NOW)).toEqual({ place: null, nights: 5 });
  });

  it("is null when every house in the country is a booking or a cancellation", () => {
    const lodgings: PassportLodging[] = [
      {
        isoCountryCode: "GR",
        city: "Athina",
        stays: [stay("2024-09-01T00:00:00Z", "2024-09-08T00:00:00Z")],
      },
      {
        isoCountryCode: "GR",
        city: "Thessaloniki",
        stays: [stay("2023-09-01T00:00:00Z", "2023-09-08T00:00:00Z", { status: "cancelled" })],
      },
    ];
    expect(lodgingStamp(lodgings, NOW)).toBeNull();
    const passport = buildPassport([], new Map(), [], NOW, [], [], lodgings);
    expect(passport.countries.find((c) => c.code === "GR")).toBeUndefined();
  });
});
