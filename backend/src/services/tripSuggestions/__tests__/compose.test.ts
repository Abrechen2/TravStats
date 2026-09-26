import { describe, expect, it } from "@jest/globals";

import { composeSuggestions } from "../compose";
import { homeFromHistory } from "../context";
import { AT, cruise, input, ride, stay, trip, visit } from "./fixtures";

/**
 * The trip-suggestion engine across domains (owner decision 2026-09-26): an
 * absence becomes a proposal with at least one night away AND at least two
 * entries; a day trip stays trip-less; entries already in a trip are never
 * proposed for a new one.
 */

const italyWeek = () => [
  ride(
    "rail",
    "out",
    AT.MUNICH_HBF,
    AT.FIRENZE,
    { day: "2025-05-03", hour: 7 },
    { day: "2025-05-03", hour: 15 }
  ),
  stay("florence", AT.FIRENZE, "2025-05-03", "2025-05-06", "Florenz"),
  stay("rome", AT.ROMA, "2025-05-06", "2025-05-09", "Rom"),
  visit("colosseum", AT.COLOSSEUM, "2025-05-07", { city: "Rom" }),
  ride(
    "rail",
    "back",
    AT.ROMA,
    AT.MUNICH_HBF,
    { day: "2025-05-09", hour: 8 },
    { day: "2025-05-09", hour: 19 }
  ),
];

describe("composeSuggestions — new trips", () => {
  it("proposes a rail-and-hotel week in Italy with no flight at all", () => {
    const out = composeSuggestions(input({ entries: italyWeek() }));

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "new_trip",
      startDay: "2025-05-03",
      endDay: "2025-05-09",
      nights: 6,
      destination: "Rom",
    });
    expect(out[0].members.map((m) => m.key).sort()).toEqual(
      ["lodging:florence", "lodging:rome", "place:colosseum", "rail:back", "rail:out"].sort()
    );
  });

  it("makes ONE trip of a cruise and the trains to and from its port", () => {
    const entries = [
      ride(
        "rail",
        "to-kiel",
        AT.MUNICH_HBF,
        AT.KIEL,
        { day: "2025-07-01", hour: 6 },
        { day: "2025-07-01", hour: 14 }
      ),
      cruise("baltic", [
        { at: AT.KIEL, day: "2025-07-01" },
        { at: AT.OSLO, day: "2025-07-03" },
        { at: AT.COPENHAGEN, day: "2025-07-05" },
        { at: AT.KIEL, day: "2025-07-08" },
      ]),
      ride(
        "rail",
        "from-kiel",
        AT.KIEL,
        AT.MUNICH_HBF,
        { day: "2025-07-08", hour: 11 },
        { day: "2025-07-08", hour: 20 }
      ),
    ];
    const out = composeSuggestions(input({ entries }));

    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("new_trip");
    expect(out[0].nights).toBe(7);
    expect(out[0].members).toHaveLength(3);
  });

  it("leaves a day trip trip-less, however many entries it has", () => {
    const entries = [
      ride(
        "rail",
        "out",
        AT.MUNICH_HBF,
        AT.NUREMBERG_HBF,
        { day: "2025-03-08", hour: 8 },
        { day: "2025-03-08", hour: 9 }
      ),
      visit("castle", AT.NUREMBERG_HBF, "2025-03-08"),
      ride(
        "rail",
        "back",
        AT.NUREMBERG_HBF,
        AT.MUNICH_HBF,
        { day: "2025-03-08", hour: 18 },
        { day: "2025-03-08", hour: 19 }
      ),
    ];
    expect(composeSuggestions(input({ entries }))).toEqual([]);
  });

  it("does not propose one entry, even with nights away", () => {
    const entries = [stay("alone", AT.FIRENZE, "2025-05-03", "2025-05-06", "Florenz")];
    expect(composeSuggestions(input({ entries }))).toEqual([]);
  });

  it("splits two trips at a RECORDED return home, even two days apart", () => {
    const flight = (id: string, from: typeof AT.MUC, to: typeof AT.MUC, day: string, h: number) =>
      ride("flight", id, from, to, { day, hour: h }, { day, hour: h + 3 });
    const entries = [
      flight("a1", AT.MUC, AT.LIS, "2025-09-01", 7),
      stay("a", AT.LISBON_HOTEL, "2025-09-01", "2025-09-04", "Lissabon"),
      flight("a2", AT.LIS, AT.MUC, "2025-09-04", 12),
      flight("b1", AT.MUC, AT.LIS, "2025-09-06", 7),
      stay("b", AT.LISBON_HOTEL, "2025-09-06", "2025-09-08", "Lissabon"),
      flight("b2", AT.LIS, AT.MUC, "2025-09-08", 12),
    ];
    const out = composeSuggestions(input({ entries }));
    expect(out.map((p) => [p.startDay, p.endDay])).toEqual([
      ["2025-09-06", "2025-09-08"],
      ["2025-09-01", "2025-09-04"],
    ]);
  });

  it("keeps a hub flyer's journey whole across a change of planes at home", () => {
    const entries = [
      ride(
        "flight",
        "in",
        AT.LIS,
        AT.MUC,
        { day: "2025-10-01", hour: 6 },
        { day: "2025-10-01", hour: 10 }
      ),
      ride(
        "flight",
        "on",
        AT.MUC,
        AT.JFK,
        { day: "2025-10-01", hour: 13 },
        { day: "2025-10-01", hour: 16 }
      ),
      stay("ny", AT.JFK, "2025-10-01", "2025-10-04", "New York"),
    ];
    const out = composeSuggestions(input({ entries }));
    expect(out).toHaveLength(1);
    expect(out[0].members).toHaveLength(3);
  });

  it("splits at a departure from home the next morning, with no way back recorded", () => {
    const entries = [
      ride(
        "flight",
        "zrh",
        AT.MUC,
        AT.FIRENZE,
        { day: "2026-07-21", hour: 8 },
        { day: "2026-07-21", hour: 10 }
      ),
      stay("z", AT.FIRENZE, "2026-07-21", "2026-07-22", "Florenz"),
      ride(
        "flight",
        "ist",
        AT.MUC,
        AT.ROMA,
        { day: "2026-07-23", hour: 7 },
        { day: "2026-07-23", hour: 9 }
      ),
      stay("i", AT.ROMA, "2026-07-23", "2026-07-25", "Rom"),
    ];
    const out = composeSuggestions(input({ entries }));
    expect(out.map((p) => p.startDay)).toEqual(["2026-07-23", "2026-07-21"]);
  });

  it("counts an unrecorded night only far from home", () => {
    // Two lake days 80 km out, no stay: the user drove home in between.
    const lake = { lat: 47.7, lon: 12.45 };
    const near = [visit("a", lake, "2025-06-07"), visit("b", lake, "2025-06-08")];
    expect(composeSuggestions(input({ entries: near }))).toEqual([]);
    // The same two days in Florence cannot have been driven back and forth.
    const far = [visit("a", AT.FIRENZE, "2025-06-07"), visit("b", AT.FIRENZE, "2025-06-08")];
    expect(composeSuggestions(input({ entries: far }))[0]).toMatchObject({ nights: 1 });
  });

  it("marks a trip that has not happened yet as planned", () => {
    const planned = italyWeek().map((e) => ({ ...e, state: "planned" as const }));
    expect(composeSuggestions(input({ entries: planned }))[0].planned).toBe(true);
  });
});

// Acceptance D3 (2026-09-26): a cruise 28.10.–04.11. that began the day the
// flight home landed (a layover longer than a change of planes) was an absence
// of its own — a single entry, so no proposal — and the trip accepted for the
// flight then offered to "extend" itself by it. Entries sharing a day are one
// journey.
describe("composeSuggestions — an entry overlapping the absence", () => {
  const spainAndCruise = () => [
    ride(
      "flight",
      "out",
      AT.MUC,
      AT.LIS,
      { day: "2025-10-24", hour: 8 },
      { day: "2025-10-24", hour: 11 }
    ),
    stay("lisbon", AT.LISBON_HOTEL, "2025-10-24", "2025-10-27", "Lissabon"),
    ride(
      "flight",
      "home",
      AT.LIS,
      AT.MUC,
      { day: "2025-10-28", hour: 5 },
      { day: "2025-10-28", hour: 8 }
    ),
    cruise("north", [
      { at: AT.KIEL, day: "2025-10-28" },
      { at: AT.OSLO, day: "2025-10-30" },
      { at: AT.COPENHAGEN, day: "2025-11-02" },
      { at: AT.KIEL, day: "2025-11-04" },
    ]),
  ];

  it("takes the overlapping cruise into the proposal and spans its days", () => {
    const out = composeSuggestions(input({ entries: spainAndCruise() }));

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "new_trip",
      startDay: "2025-10-24",
      endDay: "2025-11-04",
    });
    expect(out[0].members.map((m) => m.key)).toContain("cruise:north");
  });
});

describe("composeSuggestions — existing trips", () => {
  it("never proposes a new trip for entries already in one", () => {
    const entries = italyWeek().map((e) => ({ ...e, tripId: "t1" }));
    expect(
      composeSuggestions(input({ entries, trips: [trip("t1", "2025-05-03", "2025-05-09")] }))
    ).toEqual([]);
  });

  it("offers the trip-less entries of a trip's absence to that trip", () => {
    const [out, florence, rome, colosseum, back] = italyWeek();
    const entries = [
      { ...out, tripId: "t1" },
      florence,
      rome,
      colosseum,
      { ...back, tripId: "t1" },
    ];
    const result = composeSuggestions(
      input({ entries, trips: [trip("t1", "2025-05-03", "2025-05-09")] })
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "assign", trip: { id: "t1" } });
    expect(result[0].members).toHaveLength(3);
  });

  it("offers to stretch a trip when adjacent entries lie outside it, with the new span", () => {
    const entries = [
      stay("booked", AT.LISBON_HOTEL, "2025-09-01", "2025-09-04", "Lissabon", { tripId: "t1" }),
      stay("extra", AT.LISBON_HOTEL, "2025-09-04", "2025-09-08", "Lissabon"),
    ];
    const result = composeSuggestions(
      input({ entries, trips: [trip("t1", "2025-09-01", "2025-09-04")] })
    );
    expect(result[0]).toMatchObject({
      kind: "extend",
      newSpan: { startDay: "2025-09-01", endDay: "2025-09-08" },
    });
  });
});

describe("composeSuggestions — guards measured on the demo account", () => {
  it("does not glue on a flight 'loop' that spans months", () => {
    const out = composeSuggestions(
      input({
        entries: [
          ride(
            "flight",
            "1",
            AT.MUC,
            AT.LIS,
            { day: "2025-01-10", hour: 7 },
            { day: "2025-01-10", hour: 10 }
          ),
          stay("a", AT.LISBON_HOTEL, "2025-01-10", "2025-01-12", "Lissabon"),
          stay("b", AT.LISBON_HOTEL, "2025-04-10", "2025-04-12", "Lissabon"),
          ride(
            "flight",
            "2",
            AT.LIS,
            AT.MUC,
            { day: "2025-04-12", hour: 12 },
            { day: "2025-04-12", hour: 15 }
          ),
        ],
        clusters: [{ source: "home_loop", flightKeys: ["flight:1", "flight:2"] }],
      })
    );
    expect(out.map((p) => [p.startDay, p.endDay])).toEqual([
      ["2025-04-10", "2025-04-12"],
      ["2025-01-10", "2025-01-12"],
    ]);
  });

  it("lends no window to a dateless trip whose entries span years", () => {
    const entries = [
      visit("old", AT.ROMA, "2021-07-21", { tripId: "t1" }),
      visit("new", AT.ROMA, "2026-01-21", { tripId: "t1" }),
      ...italyWeek(),
    ];
    const out = composeSuggestions(input({ entries, trips: [trip("t1", null, null)] }));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("new_trip");
  });
});

describe("composeSuggestions — home over time", () => {
  it("judges each day against the home that was valid then", () => {
    const homeAt = homeFromHistory(
      [
        { iata: "MUC", fromDate: "2020-01-01", toDate: "2024-01-01" },
        { iata: "BER", fromDate: "2024-01-01", toDate: null },
      ],
      new Map([
        ["MUC", AT.MUC],
        ["BER", AT.BER],
      ])
    );
    const berlin = (id: string, from: string, to: string) => stay(id, AT.BER, from, to, "Berlin");
    const berlinVisit = (id: string, day: string) => visit(id, AT.BER, day);

    const before = [berlin("x", "2023-05-01", "2023-05-04"), berlinVisit("x", "2023-05-02")];
    const after = [berlin("y", "2025-05-01", "2025-05-04"), berlinVisit("y", "2025-05-02")];

    const out = composeSuggestions(input({ entries: [...before, ...after], homeAt }));
    expect(out).toHaveLength(1);
    expect(out[0].startDay).toBe("2023-05-01");
  });

  it("takes the first home for days before the history begins", () => {
    const homeAt = homeFromHistory(
      [{ iata: "MUC", fromDate: "2025-01-01", toDate: null }],
      new Map([["MUC", AT.MUC]])
    );
    expect(homeAt("2019-06-01")).toEqual(AT.MUC);
  });
});

describe("composeSuggestions — answered proposals", () => {
  const first = () => composeSuggestions(input({ entries: italyWeek() }))[0];

  it("does not bring back a dismissed proposal", () => {
    const shown = first();
    const answered = [
      {
        kind: shown.kind,
        fingerprint: shown.id,
        targetId: null,
        memberKeys: shown.members.map((m) => m.key),
      },
    ];
    expect(composeSuggestions(input({ entries: italyWeek(), answered }))).toEqual([]);
  });

  it("does not bring it back for one more entry either", () => {
    const shown = first();
    const answered = [
      {
        kind: shown.kind,
        fingerprint: shown.id,
        targetId: null,
        memberKeys: shown.members.map((m) => m.key),
      },
    ];
    const entries = [...italyWeek(), visit("pantheon", AT.ROMA, "2025-05-08")];
    expect(composeSuggestions(input({ entries, answered }))).toEqual([]);
  });

  it("brings it back once most of its entries are new", () => {
    const shown = first();
    const answered = [
      {
        kind: shown.kind,
        fingerprint: shown.id,
        targetId: null,
        memberKeys: shown.members.slice(0, 2).map((m) => m.key),
      },
    ];
    const out = composeSuggestions(input({ entries: italyWeek(), answered }));
    expect(out).toHaveLength(1);
  });
});

describe("composeSuggestions — no home known", () => {
  it("falls back to the flight heuristics' journeys and nothing else", () => {
    const entries = [
      ride(
        "flight",
        "1",
        AT.MUC,
        AT.LIS,
        { day: "2025-09-01", hour: 7 },
        { day: "2025-09-01", hour: 10 }
      ),
      stay("h", AT.LISBON_HOTEL, "2025-09-01", "2025-09-04", "Lissabon"),
      ride(
        "flight",
        "2",
        AT.LIS,
        AT.MUC,
        { day: "2025-09-04", hour: 12 },
        { day: "2025-09-04", hour: 15 }
      ),
      ...italyWeek(),
    ];
    const out = composeSuggestions(
      input({
        entries,
        homeAt: () => null,
        homeKnown: false,
        clusters: [{ source: "home_loop", flightKeys: ["flight:1", "flight:2"] }],
      })
    );
    expect(out).toHaveLength(1);
    expect(out[0].signals).toEqual(["home_loop"]);
    expect(out[0].members.map((m) => m.key).sort()).toEqual(
      ["flight:1", "flight:2", "lodging:h"].sort()
    );
  });
});
