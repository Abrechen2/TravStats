import type { CountableStay } from "../../../shared/countryEvidence";
import { buildPassport, type PassportFlight, type PassportLodging } from "../passport";

/**
 * The passport counts through `shared/countryEvidence.ts` — spec
 * `docs/superpowers/specs/2026-09-02-country-counting-design.md`.
 *
 * What these pin is the pair of failures that made the headline wrong in BOTH
 * directions at once, which is why it looked plausible for so long:
 *
 *   1. A four-hour connection counted as a country. Seven of the owner's
 *      countries are connections under five hours.
 *   2. A country reached by car and slept in for a week did not count at all,
 *      because lodging was not evidence here. Three of the owner's countries
 *      exist only that way.
 *
 * And the two boundaries that keep the fix honest: a country classed `transit`
 * still appears in the LIST (the tier is a hint, not a verdict — Ethiopia shows
 * 4.7 hours of ground time here and three GPS-measured days in an independent
 * tracker), and a stay that has not happened yet is a booking, not a visit.
 */

const AIRPORTS = new Map<string, string | null>([
  ["MUC", "DE"],
  ["FRA", "DE"],
  ["DOH", "QA"],
  ["SIN", "SG"],
  ["FCO", "IT"],
  ["NAP", "IT"],
  ["BCN", "ES"],
]);

const NOW = new Date("2026-09-02T12:00:00Z");

const flight = (
  dep: string,
  arr: string,
  localDay: string,
  over: Partial<PassportFlight> = {}
): PassportFlight => ({
  depIata: dep,
  depLat: 0,
  depLon: 0,
  arrIata: arr,
  arrLat: 0,
  arrLon: 0,
  departureTime: new Date(`${localDay}T08:00:00Z`),
  localDay,
  status: "flown",
  ...over,
});

/** MUC -> DOH -> SIN, both legs on the same local day at Doha: a connection. */
const CONNECTION: PassportFlight[] = [
  flight("MUC", "DOH", "2024-03-01"),
  flight("DOH", "SIN", "2024-03-01"),
];

const house = (code: string | null, stays: PassportLodging["stays"] = []): PassportLodging => ({
  isoCountryCode: code,
  stays,
});

/**
 * A stay as the passport hands it over. `completed` is the column default, so
 * every case that is not about cancellation reads exactly as it did before the
 * status started travelling.
 */
const stay = (checkOut: string | null, status = "completed"): CountableStay => ({
  status,
  checkIn: null,
  checkOut: checkOut === null ? null : new Date(`${checkOut}T00:00:00Z`),
});

describe("a house is evidence", () => {
  it("puts a country in the passport on a lodging with no stay at all — `slept`, undated", () => {
    // Owner's decision of 2026-09-02: somebody took the trouble to enter the
    // house, so they were there; they simply no longer remember when. Czechia,
    // Italy and Slovenia exist in the owner's account ONLY through lodging, and
    // before this the passport listed none of them while listing a four-hour
    // port call.
    const p = buildPassport([], AIRPORTS, [], NOW, [], [], [house("CZ")]);

    const cz = p.countries.find((c) => c.code === "CZ");
    expect(cz).toBeDefined();
    expect(cz?.tier).toBe("slept");
    expect(cz?.kinds).toEqual(["lodging"]);
    // The signal that found a wrongly geocoded hotel in real data: an undated
    // country can never appear in any year's figures, and without this flag
    // that reads as a gap in the data rather than a fact about it.
    expect(cz?.hasUndatedEvidence).toBe(true);
    expect(cz?.firstYear).toBeNull();
    expect(p.summary.countries).toBe(1);
  });

  it("adds no airport, no entry and no stamp for a country proved only by a house", () => {
    // The existing honesty of this derivation, and it must survive: `entries`
    // and `airports` count flights and airports. A house is neither, so a
    // country proved by one shows nothing for either — which is why the row
    // carries its evidence at all.
    const flightsOnly = buildPassport([flight("MUC", "SIN", "2024-03-01")], AIRPORTS, [], NOW);
    const withHouse = buildPassport(
      [flight("MUC", "SIN", "2024-03-01")],
      AIRPORTS,
      [],
      NOW,
      [],
      [],
      [house("CZ", [stay("2019-08-04")])]
    );

    expect(withHouse.summary.airports).toBe(flightsOnly.summary.airports);
    expect(withHouse.summary.entries).toBe(flightsOnly.summary.entries);
    expect(withHouse.stamps).toEqual(flightsOnly.stamps);

    const cz = withHouse.countries.find((c) => c.code === "CZ");
    expect(cz?.entries).toBe(0);
    expect(cz?.airports).toEqual([]);
    expect(cz?.firstYear).toBe(2019);
    expect(cz?.evidence).toBe("lodging");
    expect(withHouse.summary.byEvidence.lodging).toBe(1);
  });

  it("does NOT create a country from a stay whose check-out is still ahead", () => {
    // A booking is not a visit. It looks exactly like the decision above and is
    // its opposite: an ABSENT stay is a forgotten date, a FUTURE stay is a plan.
    const p = buildPassport([], AIRPORTS, [], NOW, [], [], [house("RO", [stay("2026-12-24")])]);

    expect(p.countries).toEqual([]);
    expect(p.summary.countries).toBe(0);
    expect(p.summary.countriesTotal).toBe(0);
  });

  it("does NOT create a country from a house whose only stay was cancelled", () => {
    // The other half of the same trap. Only `checkOut` used to reach the rule,
    // so a cancelled booking with a past check-out proved a country — and
    // filtering cancellations away in the query would have been worse still: the
    // house would have arrived as a house with NO stay, which counts as a night.
    const p = buildPassport(
      [],
      AIRPORTS,
      [],
      NOW,
      [],
      [],
      [house("RO", [stay("2024-05-04", "cancelled")])]
    );

    expect(p.countries).toEqual([]);
    expect(p.summary.countriesTotal).toBe(0);
  });

  it("still counts a house that has one cancelled stay and one that happened", () => {
    // Only the cancelled stay drops out; the night that did happen still counts,
    // and still dates the country.
    const p = buildPassport(
      [],
      AIRPORTS,
      [],
      NOW,
      [],
      [],
      [house("CZ", [stay("2018-07-01", "cancelled"), stay("2019-08-04")])]
    );

    expect(p.countries.map((c) => c.code)).toEqual(["CZ"]);
    expect(p.countries[0].firstYear).toBe(2019);
  });

  it("joins on the code, so one country entered three ways is one country", () => {
    // THE 88-versus-40 bug, in the passport's own shape. The achievements
    // unioned airport codes with the free-text `country` column and reported 88
    // countries where this passport reported 32.
    const p = buildPassport(
      [flight("MUC", "SIN", "2024-03-01")],
      AIRPORTS,
      [],
      NOW,
      [{ country: "Germany", at: new Date("2021-02-05T00:00:00Z") }],
      [],
      [house("de", [stay("2019-08-04")])]
    );

    expect(p.countries.filter((c) => c.code === "DE")).toHaveLength(1);
    expect(p.countries.find((c) => c.code === "DE")?.kinds).toEqual(["flight", "lodging", "port"]);
  });
});

describe("a connection is not a visit", () => {
  it("calls a country reached only by a same-day change of planes `transit`", () => {
    const p = buildPassport(CONNECTION, AIRPORTS, [], NOW);

    const qa = p.countries.find((c) => c.code === "QA");
    expect(qa?.tier).toBe("transit");
    expect(qa?.counted).toBe(false);
  });

  it("keeps that country in the LIST while leaving it out of the headline", () => {
    // The constraint the whole design rests on. A tier is inferred from what
    // was RECORDED, and what was recorded is incomplete — the owner has flights
    // that never reached TravStats. Ethiopia reads as 4.7 hours of ground time
    // here and as three GPS-measured days in an independent tracker. So the
    // number may exclude a country; the list may never lose one.
    const p = buildPassport(CONNECTION, AIRPORTS, [], NOW);

    expect(p.countries.map((c) => c.code).sort()).toEqual(["DE", "QA", "SG"]);
    expect(p.summary.countriesTotal).toBe(3);
    expect(p.summary.countries).toBe(2);
    expect(p.summary.countryThreshold).toBe("visited");
    expect(p.summary.byTier).toEqual({ slept: 0, visited: 2, transit: 1 });
  });

  it("calls the same two legs `slept` when the local day changed in between", () => {
    // "Different calendar day" is IN the data; "six hours" is a guess. Measured
    // on the owner's account six hours and twelve hours return the same set of
    // countries, so a configurable hour value would promise precision the data
    // does not have.
    const p = buildPassport(
      [flight("MUC", "DOH", "2024-03-01"), flight("DOH", "SIN", "2024-03-02")],
      AIRPORTS,
      [],
      NOW
    );

    expect(p.countries.find((c) => c.code === "QA")?.tier).toBe("slept");
    expect(p.summary.countries).toBe(3);
  });

  it("reads the day at the airport's clock, not the UTC instant", () => {
    // Landed in Doha late on the 1st local time, took off again the same local
    // evening — but both stored instants fall on DIFFERENT UTC days. Reading
    // UTC would report an overnight for a connection; the caller resolves the
    // clock and hands the day over.
    const p = buildPassport(
      [
        flight("MUC", "DOH", "2024-03-01", {
          departureTime: new Date("2024-03-01T20:00:00Z"),
        }),
        flight("DOH", "SIN", "2024-03-01", {
          departureTime: new Date("2024-03-02T01:00:00Z"),
        }),
      ],
      AIRPORTS,
      [],
      NOW
    );

    expect(p.countries.find((c) => c.code === "QA")?.tier).toBe("transit");
  });

  it("does not call a domestic hop a connection", () => {
    // MUC -> TXL touches Germany twice on one day, which is the same SHAPE as a
    // connection and is nothing like one. Reading it as a transit would have
    // dropped the home country of anybody who only flies domestically.
    const domestic = new Map<string, string | null>(AIRPORTS).set("TXL", "DE");
    const p = buildPassport([flight("MUC", "TXL", "2021-05-01")], domestic, [], NOW);

    expect(p.countries.find((c) => c.code === "DE")?.tier).toBe("visited");
    expect(p.summary.countries).toBe(1);
  });

  it("does not call a one-way departure or a one-way arrival a connection", () => {
    // The country somebody first flew OUT of has no arrival on record, and the
    // country they have not flown home from has no departure. Neither is a
    // change of planes, and both were correct before this change.
    const p = buildPassport([flight("MUC", "SIN", "2024-03-01")], AIRPORTS, [], NOW);

    expect(p.summary.byTier).toEqual({ slept: 0, visited: 2, transit: 0 });
    expect(p.summary.countries).toBe(2);
  });
});

describe("a day trip is not a connection", () => {
  /** MUC -> FCO in the morning, FCO -> MUC at night. A day in Rome. */
  const DAY_TRIP: PassportFlight[] = [
    flight("MUC", "FCO", "2024-03-01"),
    flight("FCO", "MUC", "2024-03-01", {
      departureTime: new Date("2024-03-01T19:00:00Z"),
    }),
  ];

  it("counts a same-day out-and-back — the country came back, so it was not a connection", () => {
    // THE DEFECT. Both same-day shapes were filed as `transit`, so a day spent
    // in Rome dropped Italy out of the headline. A connection continues ONWARD;
    // this one returns to the country it started in.
    const p = buildPassport(DAY_TRIP, AIRPORTS, [], NOW);

    const it_ = p.countries.find((c) => c.code === "IT");
    expect(it_?.tier).toBe("visited");
    expect(it_?.counted).toBe(true);
    expect(p.summary.countries).toBe(2);
    expect(p.summary.byTier).toEqual({ slept: 0, visited: 2, transit: 0 });
  });

  it("still calls a same-day change of planes `transit` when the journey goes on", () => {
    // The boundary. MUC -> DOH -> SIN is the same two-flight shape and means the
    // opposite: nobody came back, the traveller passed through. If this ever
    // turned `visited`, the seven sub-five-hour connections §1.1 measured would
    // all be back in the headline.
    const p = buildPassport(CONNECTION, AIRPORTS, [], NOW);

    expect(p.countries.find((c) => c.code === "QA")?.tier).toBe("transit");
  });

  it("reads the return at COUNTRY level, not airport level", () => {
    // MUC -> FCO -> FRA is a day in Rome between two German airports just as
    // much as MUC -> FCO -> MUC is. Comparing airport codes would have counted
    // only the traveller who happened to fly home to the airport they left from.
    const p = buildPassport(
      [
        flight("MUC", "FCO", "2024-03-01"),
        flight("FCO", "FRA", "2024-03-01", {
          departureTime: new Date("2024-03-01T19:00:00Z"),
        }),
      ],
      AIRPORTS,
      [],
      NOW
    );

    expect(p.countries.find((c) => c.code === "IT")?.tier).toBe("visited");
  });

  it("keeps the AMBIGUOUS same-day triangle at `transit`", () => {
    // MUC -> FCO -> BCN cannot be told from a morning in Rome. It is also the
    // exact shape of every hub connection there is, so reading it as `visited`
    // would empty the `transit` tier rather than err at its margin. The country
    // keeps its row in the list, where a reader can see it and disagree.
    const p = buildPassport(
      [
        flight("MUC", "FCO", "2024-03-01"),
        flight("FCO", "BCN", "2024-03-01", {
          departureTime: new Date("2024-03-01T19:00:00Z"),
        }),
      ],
      AIRPORTS,
      [],
      NOW
    );

    expect(p.countries.find((c) => c.code === "IT")?.tier).toBe("transit");
    expect(p.summary.countriesTotal).toBe(3);
    expect(p.summary.countries).toBe(2);
  });

  it("judges a whole spell on the ground as one, not segment by segment", () => {
    // MUC -> FCO -> NAP -> MUC never leaves Italy in between. Read pairwise,
    // BOTH of its ground segments look like connections and Italy vanishes from
    // a headline that contains three flights to it. The run is what returned.
    const p = buildPassport(
      [
        flight("MUC", "FCO", "2024-03-01"),
        flight("FCO", "NAP", "2024-03-01", {
          departureTime: new Date("2024-03-01T12:00:00Z"),
        }),
        flight("NAP", "MUC", "2024-03-01", {
          departureTime: new Date("2024-03-01T19:00:00Z"),
        }),
      ],
      AIRPORTS,
      [],
      NOW
    );

    expect(p.countries.find((c) => c.code === "IT")?.tier).toBe("visited");
    expect(p.summary.countries).toBe(2);
  });

  it("still calls an overnight `slept`, whether or not the traveller returned", () => {
    // The day change outranks everything this rule decides. A return that spans
    // a night is not demoted to `visited` by being a return.
    const p = buildPassport(
      [flight("MUC", "FCO", "2024-03-01"), flight("FCO", "MUC", "2024-03-04")],
      AIRPORTS,
      [],
      NOW
    );

    expect(p.countries.find((c) => c.code === "IT")?.tier).toBe("slept");
  });

  it("does not read a return out of an unknown origin country", () => {
    // The inbound flight left an airport the catalogue does not know. `null ===
    // null` must not pass for "came back": that would upgrade a country on the
    // strength of a missing value.
    const p = buildPassport(
      [
        flight("XXX", "FCO", "2024-03-01"),
        flight("FCO", "YYY", "2024-03-01", {
          departureTime: new Date("2024-03-01T19:00:00Z"),
        }),
      ],
      AIRPORTS,
      [],
      NOW
    );

    expect(p.countries.find((c) => c.code === "IT")?.tier).toBe("transit");
  });
});

describe("strongest evidence wins, once", () => {
  it("reports a country both flown through and slept in as `slept`, in a single row", () => {
    // Austria in the owner's account: 24 houses, 9 stays — and the passport
    // counted it ONLY because of a single 0.9-hour connection. Remove that
    // transit and a country with nine stays disappeared.
    const p = buildPassport(
      CONNECTION,
      AIRPORTS,
      [],
      NOW,
      [],
      [],
      [house("QA", [stay("2024-03-05")])]
    );

    const rows = p.countries.filter((c) => c.code === "QA");
    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBe("slept");
    expect(rows[0].counted).toBe(true);
    // Both kinds stay listed. The tier says how strong the proof is; `kinds`
    // says where it came from, and only the second can answer "why is this
    // country here".
    expect(rows[0].kinds).toEqual(["flight", "lodging"]);
    // The LABEL still reads "flown", exactly as it did before lodging existed
    // here — the rank decides which single kind a row wears, not how strong the
    // proof is.
    expect(rows[0].evidence).toBe("flight");
    expect(p.summary.countries).toBe(3);
  });

  it("splits by kind over the whole list, not over the headline", () => {
    // `byEvidence` describes every row; `countries` applies a threshold to
    // them. A client that assumed the two agree would be wrong the moment one
    // country is a connection — which is why `countriesTotal` is published.
    const p = buildPassport(CONNECTION, AIRPORTS, [], NOW, [], [], [house("CZ")]);

    const { flight: f, port, place, lodging } = p.summary.byEvidence;
    expect(f + port + place + lodging).toBe(p.summary.countriesTotal);
    expect(p.summary.countriesTotal).toBe(4);
    expect(p.summary.countries).toBe(3);
  });
});

describe("ports and places keep working, mapped onto the tiers", () => {
  it("calls a port call that spanned a night `slept` and a day in port `visited`", () => {
    const overnight = buildPassport([], AIRPORTS, [], NOW, [
      {
        country: "Italy",
        at: new Date("2023-07-04T20:00:00Z"),
        until: new Date("2023-07-05T06:00:00Z"),
      },
    ]);
    const dayCall = buildPassport([], AIRPORTS, [], NOW, [
      {
        country: "Italy",
        at: new Date("2023-07-04T08:00:00Z"),
        until: new Date("2023-07-04T18:00:00Z"),
      },
    ]);

    expect(overnight.countries.find((c) => c.code === "IT")?.tier).toBe("slept");
    expect(dayCall.countries.find((c) => c.code === "IT")?.tier).toBe("visited");
  });

  it("calls a port call with no departure time `visited` — what it can prove", () => {
    const p = buildPassport([], AIRPORTS, [], NOW, [
      { country: "Italy", at: new Date("2023-07-04T08:00:00Z") },
    ]);

    expect(p.countries.find((c) => c.code === "IT")?.tier).toBe("visited");
    expect(p.summary.countries).toBe(1);
  });

  it("calls a recorded place `visited`", () => {
    const p = buildPassport(
      [],
      AIRPORTS,
      [],
      NOW,
      [],
      [{ isoCountryCode: "pt", at: new Date("2022-05-01T00:00:00Z") }]
    );

    expect(p.countries.find((c) => c.code === "PT")?.tier).toBe("visited");
  });

  it("still ignores a place and a house whose country nobody can resolve", () => {
    // Never a guess. `shared/placeCounting.ts` makes the same cut for the same
    // reason: a country a reader cannot check by looking is worse than a
    // missing one.
    const p = buildPassport(
      [],
      AIRPORTS,
      [],
      NOW,
      [],
      [{ isoCountryCode: null, at: new Date("2022-05-01T00:00:00Z") }],
      [house(null), house("Atlantis")]
    );

    expect(p.countries).toEqual([]);
  });
});

/**
 * Spec §3.4b: the stats SHOW hours, they still do not DECIDE by them.
 *
 * A duration stands beside the tier as evidence and is never a threshold — the
 * tier keeps coming from structure. What these pin is the shape of the two
 * figures the design promised and no endpoint published, and above all the
 * three-state ground time: a country proved only by a hotel has an UNKNOWN
 * ground time, not a zero one, and writing `0 h` there would be the fabrication
 * `shared/flightDuration.ts` was written to end.
 */
describe("the evidence beside the tier", () => {
  /** A stay with both ends, which the fixture above deliberately does not have. */
  const dated = (from: string, to: string, status = "completed"): CountableStay => ({
    status,
    checkIn: new Date(`${from}T00:00:00Z`),
    checkOut: new Date(`${to}T00:00:00Z`),
  });

  /** MUC -> DOH -> SIN, three hours on the ground in Doha, all on one local day. */
  const MEASURED_CONNECTION: PassportFlight[] = [
    flight("MUC", "DOH", "2024-03-01", {
      departureInstant: new Date("2024-03-01T08:00:00Z"),
      arrivalInstant: new Date("2024-03-01T14:00:00Z"),
    }),
    flight("DOH", "SIN", "2024-03-01", {
      departureTime: new Date("2024-03-01T17:00:00Z"),
      departureInstant: new Date("2024-03-01T17:00:00Z"),
      arrivalInstant: new Date("2024-03-02T05:00:00Z"),
    }),
  ];

  it("publishes the MEASURED minutes on the ground, raw and unbucketed", () => {
    // §3.4b decided this off the data: the owner's connection countries run
    // 1.4 h to 4.7 h and the next is France at 25 h. Fixed bins would leave the
    // middle permanently empty and hide the gap, which IS the finding.
    const p = buildPassport(MEASURED_CONNECTION, AIRPORTS, [], NOW);

    expect(p.countries.find((c) => c.code === "QA")?.groundTime).toEqual({
      state: "measured",
      minutes: 180,
    });
    // And it still decides nothing: three hours is a connection because the
    // journey went onward, not because three is below some number.
    expect(p.countries.find((c) => c.code === "QA")?.tier).toBe("transit");
  });

  it("reports a lodging-only country as notApplicable — never as zero", () => {
    // THE RULE. A house bounds no departure, so there is no ground time to
    // read; a zero would be a measurement nobody made, and it would drag every
    // average that ever touches this field down.
    const p = buildPassport([], AIRPORTS, [], NOW, [], [], [house("CZ", [dated("2019-08-01", "2019-08-04")])]);

    const cz = p.countries.find((c) => c.code === "CZ");
    expect(cz?.groundTime).toEqual({ state: "notApplicable" });
    expect(cz?.tier).toBe("slept");
  });

  it("keeps `unknown` apart from `notApplicable` where a flight was involved", () => {
    // A one-way arrival: the traveller was in Singapore for some length of time
    // and nothing on record says how long. That asks the reader for something —
    // add the return leg — which "no flight ever touched this country" does not.
    const p = buildPassport([flight("MUC", "SIN", "2024-03-01")], AIRPORTS, [], NOW);

    expect(p.countries.find((c) => c.code === "SG")?.groundTime).toEqual({ state: "unknown" });
  });

  it("abstains rather than subtracting placeholders the caller could not resolve", () => {
    // A DATE_ONLY row carries a 12:00 placeholder and the loader hands it over
    // as a null instant. A naive subtraction would answer a confident number for
    // a row that holds no clock at all.
    const p = buildPassport(CONNECTION, AIRPORTS, [], NOW);

    expect(p.countries.find((c) => c.code === "QA")?.groundTime).toEqual({ state: "unknown" });
  });

  it("counts distinct days for a country dated ONLY by a house", () => {
    // Why the design prefers days to hours: a day exists for a house, a port
    // call and a flight pair alike. Four days present, three nights slept —
    // this answers the first question, which is the one the tier is judged on.
    const p = buildPassport([], AIRPORTS, [], NOW, [], [], [house("CZ", [dated("2019-08-01", "2019-08-04")])]);

    expect(p.countries.find((c) => c.code === "CZ")?.daysPresent).toBe(4);
  });

  it("reports zero days for an undated house, and says why beside it", () => {
    // Zero here is DERIVED, not abstained: no record names a single day. It is
    // only readable next to `hasUndatedEvidence`, which is why the two travel
    // together — otherwise "0 days" looks like a country nobody went to.
    const p = buildPassport([], AIRPORTS, [], NOW, [], [], [house("CZ")]);

    const cz = p.countries.find((c) => c.code === "CZ");
    expect(cz?.daysPresent).toBe(0);
    expect(cz?.hasUndatedEvidence).toBe(true);
  });

  it("unions the days, so one day proved twice is one day", () => {
    const p = buildPassport(
      MEASURED_CONNECTION,
      AIRPORTS,
      [],
      NOW,
      [],
      [{ isoCountryCode: "QA", at: new Date("2024-03-01T15:00:00Z") }],
      []
    );

    expect(p.countries.find((c) => c.code === "QA")?.daysPresent).toBe(1);
  });

  it("counts a spell's two ENDPOINT days, at the airport's clock — not the range", () => {
    // Landed on the 1st local, left on the 4th local. The records attest those
    // two days and nothing about the 2nd and the 3rd: the traveller may have
    // driven to Slovenia and back, and the flight log cannot tell. Two days,
    // and the same overnight that makes the tier `slept` — the contribution
    // changed on 2026-09-02, what the spell PROVES did not.
    const p = buildPassport(
      [flight("MUC", "FCO", "2024-03-01"), flight("FCO", "MUC", "2024-03-04")],
      AIRPORTS,
      [],
      NOW
    );

    const it_ = p.countries.find((c) => c.code === "IT");
    expect(it_?.daysPresent).toBe(2);
    expect(it_?.tier).toBe("slept");
  });
});

/**
 * A spell between two flights is not a stay — owner's decision, 2026-09-02.
 *
 * **Ground time measures the absence of a recorded departure, not presence.**
 * Measured on the beta server that day: an account's HOME country reported
 * `daysPresent: 2200` and a ground time of 3,136,245 minutes — 5.5 years —
 * because the records held a landing in Munich on 2020-01-26 and the next
 * German departure on 2025-07-16 with nothing logged in between. Both figures
 * were literally correct and both were nonsense, and the shape is structurally
 * guaranteed for the one country every user has: home is where the gaps are.
 *
 * What these pin is that the spell now contributes its two endpoint days and
 * abstains from a duration past one night — and that NO TIER MOVED, because
 * this is about what a spell contributes, never about what it proves.
 */
describe("a gap in the flight log is not time spent in a country", () => {
  /** The measured case, reduced: land in Munich, fly out of Munich 5.5 years later. */
  const HOME_GAP: PassportFlight[] = [
    flight("SIN", "MUC", "2020-01-26", {
      departureInstant: new Date("2020-01-25T22:00:00Z"),
      arrivalInstant: new Date("2020-01-26T06:00:00Z"),
    }),
    flight("MUC", "SIN", "2025-07-16", {
      departureInstant: new Date("2025-07-16T10:00:00Z"),
      arrivalInstant: new Date("2025-07-17T04:00:00Z"),
    }),
  ];

  it("counts TWO days for the 5.5-year home-country gap, not 2200", () => {
    const de = buildPassport(HOME_GAP, AIRPORTS, [], NOW).countries.find((c) => c.code === "DE");

    expect(de?.daysPresent).toBe(2);
  });

  it("reports that gap's ground time as unknown, not as 3,136,245 measured minutes", () => {
    // `unknown` is the state that already means "a flight touched this country
    // but no pair of clocks bounds a stay", and its UI copy — add the missing
    // flight — is exactly the right instruction for a gap caused by unlogged
    // flights. No fourth state was invented for this.
    const de = buildPassport(HOME_GAP, AIRPORTS, [], NOW).countries.find((c) => c.code === "DE");

    expect(de?.groundTime).toEqual({ state: "unknown" });
  });

  it("still calls the gap `slept`, because the tier was never the thing that was wrong", () => {
    const de = buildPassport(HOME_GAP, AIRPORTS, [], NOW).countries.find((c) => c.code === "DE");

    expect(de?.tier).toBe("slept");
  });

  it("keeps a 25-hour stopover measured — one night is still a stay", () => {
    // The contrast §3.4b exists to draw, and the reason the boundary is one
    // night rather than none: the owner's connection countries run 1.4 h–4.7 h
    // and the next country is France at 25 h. Losing that figure would delete
    // the finding the whole section was written around.
    const p = buildPassport(
      [
        flight("MUC", "FCO", "2024-03-01", {
          departureInstant: new Date("2024-03-01T08:00:00Z"),
          arrivalInstant: new Date("2024-03-01T10:00:00Z"),
        }),
        flight("FCO", "BCN", "2024-03-02", {
          departureInstant: new Date("2024-03-02T11:00:00Z"),
          arrivalInstant: new Date("2024-03-02T13:00:00Z"),
        }),
      ],
      AIRPORTS,
      [],
      NOW
    );

    const it_ = p.countries.find((c) => c.code === "IT");
    expect(it_?.groundTime).toEqual({ state: "measured", minutes: 1500 });
    expect(it_?.daysPresent).toBe(2);
    expect(it_?.tier).toBe("slept");
  });

  it("abstains one night later, on the same shape", () => {
    // Two nights and the interval stops describing a stay. Nothing else about
    // the pair changed — which is what makes the night the boundary rather than
    // a duration somebody picked.
    const p = buildPassport(
      [
        flight("MUC", "FCO", "2024-03-01", {
          departureInstant: new Date("2024-03-01T08:00:00Z"),
          arrivalInstant: new Date("2024-03-01T10:00:00Z"),
        }),
        flight("FCO", "BCN", "2024-03-03", {
          departureInstant: new Date("2024-03-03T11:00:00Z"),
          arrivalInstant: new Date("2024-03-03T13:00:00Z"),
        }),
      ],
      AIRPORTS,
      [],
      NOW
    );

    const it_ = p.countries.find((c) => c.code === "IT");
    expect(it_?.groundTime).toEqual({ state: "unknown" });
    expect(it_?.daysPresent).toBe(2);
    expect(it_?.tier).toBe("slept");
  });

  it("leaves a same-day connection exactly as it was: one day, measured minutes", () => {
    // The regression guard for the whole change. A connection is the case the
    // inference was always safe for, and it must not move by a minute or a day.
    const connection: PassportFlight[] = [
      flight("MUC", "DOH", "2024-03-01", {
        departureInstant: new Date("2024-03-01T08:00:00Z"),
        arrivalInstant: new Date("2024-03-01T14:00:00Z"),
      }),
      flight("DOH", "SIN", "2024-03-01", {
        departureTime: new Date("2024-03-01T17:00:00Z"),
        departureInstant: new Date("2024-03-01T17:00:00Z"),
        arrivalInstant: new Date("2024-03-02T05:00:00Z"),
      }),
    ];
    const qa = buildPassport(connection, AIRPORTS, [], NOW).countries.find((c) => c.code === "QA");

    expect(qa?.daysPresent).toBe(1);
    expect(qa?.groundTime).toEqual({ state: "measured", minutes: 180 });
    expect(qa?.tier).toBe("transit");
  });

  it("leaves a LODGING stay counting its full span — only the inferred gap lost its middle", () => {
    // Decision 2 of 2026-09-02. A stay from the 1st to the 4th attests four
    // days because the record says so; nothing was inferred, so nothing is
    // withdrawn. A house next to the gap above must not shrink to two.
    const p = buildPassport(
      [],
      AIRPORTS,
      [],
      NOW,
      [],
      [],
      [
        house("CZ", [
          {
            status: "completed",
            checkIn: new Date("2019-08-01T00:00:00Z"),
            checkOut: new Date("2019-08-04T00:00:00Z"),
          },
        ]),
      ]
    );

    expect(p.countries.find((c) => c.code === "CZ")?.daysPresent).toBe(4);
  });
});

/**
 * The setting — spec §3.2, step 7.
 *
 * What is being pinned here is not that a threshold filters (that is
 * `countCountries`, tested in `shared/__tests__/countryEvidence.test.ts`) but
 * the boundary the whole design rests on: **changing the setting must never
 * change what is IN the list.** A country wrongly classed as a connection has
 * to stay visible to be corrected — that is how the Bucharest hotel was found —
 * so a threshold that hid rows would put back, from the other direction, the
 * invisible arithmetic this design removes.
 */
describe("the counting threshold moves the headline and nothing else", () => {
  /**
   * One country per tier, so every threshold has something to include AND
   * something to exclude:
   *
   *   QA `transit` — MUC → DOH → SIN, both legs on the same local day at Doha
   *   SG `visited` — flown to, never out of again
   *   CZ `slept`   — a house with no stay at all (owner's decision 1.4)
   *
   * DE rides along as a second `visited`, which is what makes the middle
   * threshold's count a number rather than a coincidence.
   */
  const at = (threshold: "transit" | "visited" | "slept") =>
    buildPassport(CONNECTION, AIRPORTS, [], NOW, [], [], [house("CZ")], threshold);

  /** Every row, with the ONE field the threshold is allowed to touch removed. */
  const rowsWithoutVerdict = (p: ReturnType<typeof buildPassport>) =>
    JSON.stringify(p.countries.map(({ counted: _counted, ...rest }) => rest));

  it("returns a byte-identical country list at all three thresholds", () => {
    const [transit, visited, slept] = [at("transit"), at("visited"), at("slept")];

    expect(rowsWithoutVerdict(visited)).toBe(rowsWithoutVerdict(transit));
    expect(rowsWithoutVerdict(slept)).toBe(rowsWithoutVerdict(transit));
  });

  it("keeps `countriesTotal` and the tier split fixed while the headline moves", () => {
    const [transit, visited, slept] = [at("transit"), at("visited"), at("slept")];

    // The list is the same list, so everything that describes the WHOLE list
    // is the same too. Only the number that applies a rule to it moves.
    for (const p of [visited, slept]) {
      expect(p.summary.countriesTotal).toBe(transit.summary.countriesTotal);
      expect(p.summary.byTier).toEqual(transit.summary.byTier);
      expect(p.summary.byEvidence).toEqual(transit.summary.byEvidence);
    }

    expect(transit.summary.countries).toBe(4); // DE, QA, SG, CZ
    expect(visited.summary.countries).toBe(3); // …minus the Doha connection
    expect(slept.summary.countries).toBe(1); // …only the house
    expect(transit.summary.countriesTotal).toBe(4);
  });

  it("never removes the connection country, at any threshold", () => {
    // The row a stricter setting stops COUNTING is exactly the row a user most
    // needs to see: it is the one they might want to correct.
    for (const threshold of ["transit", "visited", "slept"] as const) {
      const qa = at(threshold).countries.find((c) => c.code === "QA");
      expect(qa).toBeDefined();
      expect(qa?.tier).toBe("transit");
      expect(qa?.counted).toBe(threshold === "transit");
    }
  });

  it("publishes the threshold it actually counted from", () => {
    // Stated rather than assumed, so a client never explains the number with a
    // rule that is not the one that produced it.
    for (const threshold of ["transit", "visited", "slept"] as const) {
      expect(at(threshold).summary.countryThreshold).toBe(threshold);
    }
  });

  it("counts from `visited` when the caller names no threshold", () => {
    const p = buildPassport(CONNECTION, AIRPORTS, [], NOW, [], [], [house("CZ")]);
    expect(p.summary.countryThreshold).toBe("visited");
    expect(p.summary.countries).toBe(3);
  });
});
