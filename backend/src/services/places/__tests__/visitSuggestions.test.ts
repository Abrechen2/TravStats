import { describe, it, expect } from "@jest/globals";
import {
  buildAnchors,
  suggestVisits,
  type AnchorSources,
  type SuggestionAnchor,
} from "../visitSuggestions";

const COLOSSEUM = { itemId: "world-heritage:91", name: "Kolosseum", lat: 41.8902, lon: 12.4922 };

const sources = (over: Partial<AnchorSources> = {}): AnchorSources => ({
  lodgings: [],
  cruiseStops: [],
  flights: [],
  places: [],
  ...over,
});

const anchor = (over: Partial<SuggestionAnchor> = {}): SuggestionAnchor => ({
  kind: "lodging",
  label: "Hotel Roma",
  lat: 41.9,
  lon: 12.5,
  at: new Date("2024-06-12T00:00:00Z"),
  ...over,
});

describe("buildAnchors", () => {
  it("turns a finished stay into a dated anchor", () => {
    const anchors = buildAnchors(
      sources({
        lodgings: [
          {
            name: "Hotel Roma",
            lat: 41.9,
            lon: 12.5,
            checkIn: new Date("2024-06-10"),
            checkOut: new Date("2024-06-14"),
            status: "confirmed",
          },
        ],
      })
    );
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ kind: "lodging", label: "Hotel Roma" });
    expect(anchors[0].at?.toISOString()).toBe(new Date("2024-06-10").toISOString());
  });

  it("ignores a stay that has not happened yet", () => {
    // A booking says where somebody WILL be. Suggesting a visit from it would
    // propose a trip that has not occurred.
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const anchors = buildAnchors(
      sources({
        lodgings: [
          {
            name: "Später",
            lat: 41.9,
            lon: 12.5,
            checkIn: future,
            checkOut: new Date(future.getTime() + 86400000),
            status: "confirmed",
          },
        ],
      })
    );
    expect(anchors).toHaveLength(0);
  });

  it("ignores a lodging with no coordinates", () => {
    const anchors = buildAnchors(
      sources({
        lodgings: [
          {
            name: "Irgendwo",
            lat: null,
            lon: null,
            checkIn: new Date("2020-01-01"),
            checkOut: new Date("2020-01-02"),
            status: "confirmed",
          },
        ],
      })
    );
    expect(anchors).toHaveLength(0);
  });

  it("takes a port call as an anchor, but not a sea day's missing port", () => {
    const anchors = buildAnchors(
      sources({
        cruiseStops: [
          { portName: "Civitavecchia", lat: 42.09, lon: 11.79, at: new Date("2023-05-02") },
          { portName: null, lat: null, lon: null, at: new Date("2023-05-03") },
        ],
      })
    );
    expect(anchors.map((a) => a.kind)).toEqual(["cruise_port"]);
  });

  it("only counts a place the user marked as visited", () => {
    const anchors = buildAnchors(
      sources({
        places: [
          { name: "War da", lat: 41.9, lon: 12.5, visited: true, visits: [] },
          { name: "Merkliste", lat: 41.9, lon: 12.5, visited: false, visits: [] },
        ],
      })
    );
    expect(anchors.map((a) => a.label)).toEqual(["War da"]);
  });

  describe("flights", () => {
    const leg = (over: Record<string, unknown> = {}) => ({
      status: "flown",
      depIata: "MUC",
      arrIata: "FCO",
      depLat: 48.35,
      depLon: 11.79,
      arrLat: 41.8,
      arrLon: 12.25,
      departureTime: new Date("2024-06-10T08:00:00Z"),
      arrivalTime: new Date("2024-06-10T09:45:00Z"),
      ...over,
    });

    it("anchors both ends of a flown leg", () => {
      const anchors = buildAnchors(sources({ flights: [leg()] }));
      expect(anchors.map((a) => a.label).sort()).toEqual(["FCO", "MUC"]);
    });

    it("ignores a leg that has not been flown", () => {
      expect(buildAnchors(sources({ flights: [leg({ status: "scheduled" })] }))).toHaveLength(0);
    });

    it("drops an airport that was only a change of planes", () => {
      // MUC → DOH, then DOH → SIN two hours later. Doha is a lounge, not a
      // country, and must not suggest anything.
      const anchors = buildAnchors(
        sources({
          flights: [
            leg({
              arrIata: "DOH",
              arrLat: 25.27,
              arrLon: 51.61,
              arrivalTime: new Date("2024-06-10T18:00:00Z"),
            }),
            leg({
              depIata: "DOH",
              depLat: 25.27,
              depLon: 51.61,
              departureTime: new Date("2024-06-10T20:00:00Z"),
              arrIata: "SIN",
              arrLat: 1.36,
              arrLon: 103.99,
              arrivalTime: new Date("2024-06-11T07:00:00Z"),
            }),
          ],
        })
      );
      expect(anchors.map((a) => a.label).sort()).toEqual(["MUC", "SIN"]);
    });

    it("keeps an airport the user actually stayed at", () => {
      // Same two legs, but a week apart — that is a trip to Qatar.
      const anchors = buildAnchors(
        sources({
          flights: [
            leg({
              arrIata: "DOH",
              arrLat: 25.27,
              arrLon: 51.61,
              arrivalTime: new Date("2024-06-10T18:00:00Z"),
            }),
            leg({
              depIata: "DOH",
              depLat: 25.27,
              depLon: 51.61,
              departureTime: new Date("2024-06-17T20:00:00Z"),
              arrIata: "SIN",
              arrLat: 1.36,
              arrLon: 103.99,
              arrivalTime: new Date("2024-06-18T07:00:00Z"),
            }),
          ],
        })
      );
      expect(anchors.map((a) => a.label).sort()).toEqual(["DOH", "MUC", "SIN"]);
    });
  });
});

describe("suggestVisits", () => {
  it("proposes a target next to a hotel, with the date and the reason", () => {
    const [s] = suggestVisits([COLOSSEUM], [anchor()]);
    expect(s).toMatchObject({
      itemId: COLOSSEUM.itemId,
      confidence: "high",
      anchorKind: "lodging",
      anchorLabel: "Hotel Roma",
    });
    expect(s.distanceKm).toBeLessThan(5);
    expect(s.visitedAt).toBe(new Date("2024-06-12T00:00:00Z").toISOString());
  });

  it("says nothing about a target nobody came near", () => {
    const tokyo = anchor({ lat: 35.68, lon: 139.69 });
    expect(suggestVisits([COLOSSEUM], [tokyo])).toEqual([]);
  });

  it("grades an airport lower than a bed", () => {
    const [s] = suggestVisits([COLOSSEUM], [anchor({ kind: "flight", label: "FCO", lat: 41.8, lon: 12.25 })]);
    expect(s.confidence).toBe("low");
  });

  it("lets the stronger anchor win even when a weaker one is closer", () => {
    // The airport is 3 km away, the hotel 8 km. The hotel still wins: distance
    // alone would let a runway outrank the bed somebody slept in.
    const results = suggestVisits(
      [COLOSSEUM],
      [
        anchor({ kind: "flight", label: "FCO", lat: 41.8902, lon: 12.528 }),
        anchor({ kind: "lodging", label: "Hotel Roma", lat: 41.8902, lon: 12.588 }),
      ]
    );
    expect(results[0].anchorKind).toBe("lodging");
  });

  it("picks the nearest anchor within one kind", () => {
    const results = suggestVisits(
      [COLOSSEUM],
      [
        anchor({ label: "Weiter weg", lat: 42.05, lon: 12.6 }),
        anchor({ label: "Um die Ecke", lat: 41.8905, lon: 12.4925 }),
      ]
    );
    expect(results[0].anchorLabel).toBe("Um die Ecke");
  });

  it("matches across a grid-cell boundary", () => {
    // The bucketing is an optimisation, not a rule: a target at 41.999 and an
    // anchor at 42.001 are 200 m apart and must still find each other.
    const results = suggestVisits(
      [{ itemId: "x", name: "Grenzfall", lat: 41.999, lon: 12.999 }],
      [anchor({ lat: 42.001, lon: 13.001 })]
    );
    expect(results).toHaveLength(1);
  });

  it("carries a null date rather than inventing one", () => {
    const [s] = suggestVisits([COLOSSEUM], [anchor({ at: null })]);
    expect(s.visitedAt).toBeNull();
  });

  it("sorts the strong evidence first", () => {
    const results = suggestVisits(
      [COLOSSEUM, { itemId: "b", name: "Zweitens", lat: 48.35, lon: 11.8 }],
      [
        anchor({ kind: "flight", label: "MUC", lat: 48.353, lon: 11.786 }),
        anchor({ kind: "lodging", label: "Hotel Roma" }),
      ]
    );
    expect(results.map((r) => r.confidence)).toEqual(["high", "low"]);
  });

  it("returns nothing at all when the user has recorded no travel", () => {
    expect(suggestVisits([COLOSSEUM], [])).toEqual([]);
  });
});
