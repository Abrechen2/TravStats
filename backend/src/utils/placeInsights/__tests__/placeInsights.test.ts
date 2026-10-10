import { computePlaceInsights, type InsightPlace } from "..";
import type { InsightVisit } from "../types";
import { wholeYears } from "../blocks";
import { totalsOf } from "../../../services/stats/insights/measureItems";

const NOW = new Date("2026-10-09T12:00:00Z");

let seq = 0;
function visit(at: string | null, over: Partial<InsightVisit> = {}): InsightVisit {
  seq += 1;
  return {
    id: `v${seq}`,
    // The Companion shape: a real instant, the place's zone, a time of day.
    visitedAt: at ? new Date(at) : null,
    visitedAtUtc: at ? new Date(at) : null,
    visitedZone: at ? "Europe/Berlin" : null,
    visitedPrecision: at ? "minute" : null,
    notes: null,
    rating: null,
    photoCount: 0,
    trip: null,
    ...over,
  };
}

function place(id: string, visits: InsightVisit[], over: Partial<InsightPlace> = {}): InsightPlace {
  return {
    id,
    name: `Ort ${id}`,
    category: "sight",
    city: "Berlin",
    isoCountryCode: "DE",
    lat: 52.52,
    lon: 13.405,
    visited: true,
    visits,
    ...over,
  };
}

describe("places insights — discoveries against returns (forgejo#259 item 1)", () => {
  it("files the first dated visit as a discovery and later ones as returns, per year", () => {
    const { insights, items } = computePlaceInsights(
      [
        place("a", [visit("2023-05-01T10:00:00Z"), visit("2024-05-01T10:00:00Z")]),
        place("b", [visit("2024-07-01T10:00:00Z")]),
      ],
      NOW
    );
    expect(insights.discoveries.byYear).toEqual([
      { year: 2023, discoveries: 1, revisits: 0, unordered: 0 },
      { year: 2024, discoveries: 1, revisits: 1, unordered: 0 },
    ]);
    expect(totalsOf(items).placeDiscoveryVisits).toEqual({
      allTime: 2,
      byYear: { "2023": 1, "2024": 1 },
    });
  });

  it("does not call a visit the first when an undated one of the same place could be earlier", () => {
    const { insights, items } = computePlaceInsights(
      [place("a", [visit(null), visit("2024-05-01T10:00:00Z")])],
      NOW
    );
    expect(insights.discoveries.byYear).toEqual([
      { year: 2024, discoveries: 0, revisits: 0, unordered: 1 },
    ]);
    expect(items.placeDiscoveryVisits).toEqual([]);
    expect(insights.discoveries.undatedVisits).toBe(1);
  });

  it("leaves a wishlist place and a visit still ahead out of everything", () => {
    const { insights } = computePlaceInsights(
      [
        place("w", [visit("2024-01-01T10:00:00Z")], { visited: false }),
        place("p", [visit("2027-01-01T10:00:00Z")]),
      ],
      NOW
    );
    expect(insights.discoveries.byYear).toEqual([]);
    expect(insights.plannedVisits).toBe(1);
    expect(insights.discoveries.placesWithoutDatedVisit).toBe(1);
  });
});

describe("places insights — returning after years (item 2)", () => {
  it("measures the longest pause on the place's own calendar and names both visits", () => {
    const first = visit("2018-06-10T10:00:00Z");
    const second = visit("2024-06-09T10:00:00Z");
    const { insights } = computePlaceInsights(
      [place("a", [first, second, visit("2024-06-12T10:00:00Z")])],
      NOW
    );
    expect(insights.revisits.longestGap).toMatchObject({
      placeId: "a",
      fromVisitId: first.id,
      toVisitId: second.id,
      from: "2018-06-10",
      to: "2024-06-09",
    });
    // One day short of six years: five whole years.
    expect(insights.revisits.longestGapYears).toBe(5);
    expect(insights.revisits.returning[0]).toMatchObject({ placeId: "a", years: [2018, 2024] });
  });

  it("opens the places returned to over the years, each once, over all years", () => {
    const { items } = computePlaceInsights(
      [
        place("a", [visit("2018-06-10T10:00:00Z"), visit("2024-06-09T10:00:00Z")]),
        place("b", [visit("2024-01-10T10:00:00Z"), visit("2024-02-10T10:00:00Z")]),
      ],
      NOW
    );
    expect(totalsOf(items).placeReturningPlaceCount.allTime).toBe(1);
    expect(items.placeReturningPlaceCount[0]).toMatchObject({ credits: ["a"], year: null });
  });

  it("counts whole years by anniversary, not by subtracting years", () => {
    expect(wholeYears("2019-06-10", "2024-06-09")).toBe(4);
    expect(wholeYears("2019-06-10", "2024-06-10")).toBe(5);
  });
});

describe("places insights — variety (item 3)", () => {
  it("counts categories per trip and per city, from the places that count", () => {
    const trip = { id: "t1", name: "Rom" };
    const { insights } = computePlaceInsights(
      [
        place("a", [visit("2024-05-01T10:00:00Z", { trip })], { category: "sight" }),
        place("b", [visit("2024-05-02T10:00:00Z", { trip })], { category: "food" }),
        place("c", [visit("2024-05-03T10:00:00Z", { trip })], { category: "museum" }),
        place("d", [visit("2024-05-04T10:00:00Z")], { category: "nature", city: "Bonn" }),
      ],
      NOW
    );
    expect(insights.diversity.trips).toEqual([
      { tripId: "t1", tripName: "Rom", year: 2024, categories: ["food", "museum", "sight"] },
    ]);
    expect(insights.diversity.tripCategoriesMax).toBe(3);
    expect(insights.diversity.visitsWithoutTrip).toBe(1);
    expect(insights.diversity.cities[0]).toMatchObject({
      city: "Berlin",
      categories: ["food", "museum", "sight"],
    });
  });
});

describe("places insights — documentation (item 4)", () => {
  it("counts photo, note and rating independently and never invents a rating", () => {
    const { insights, items } = computePlaceInsights(
      [
        place("a", [
          visit("2024-05-01T10:00:00Z", { photoCount: 2, notes: "Schön" }),
          visit("2024-05-02T10:00:00Z", { notes: "   " }),
          visit("2024-05-03T10:00:00Z", { rating: 4 }),
          visit(null, { photoCount: 1 }),
        ]),
      ],
      NOW
    );
    expect(insights.documentation).toMatchObject({
      visits: 4,
      withPhoto: 2,
      withNote: 1,
      withRating: 1,
      withNoteAndPhoto: 1,
    });
    // The undated visit counts in the lifetime figure and in no year.
    expect(totalsOf(items).placeVisitsWithPhoto).toEqual({ allTime: 2, byYear: { "2024": 1 } });
  });
});

describe("places insights — the largest jump (item 5)", () => {
  it("is a straight line between consecutive visits whose order is certain", () => {
    const { insights } = computePlaceInsights(
      [
        place("ber", [visit("2024-05-01T10:00:00Z")]),
        place("muc", [visit("2024-05-03T10:00:00Z")], {
          lat: 48.137,
          lon: 11.575,
          city: "München",
        }),
      ],
      NOW
    );
    expect(insights.jump.longest?.from.placeId).toBe("ber");
    expect(insights.jump.longest?.to.placeId).toBe("muc");
    expect(insights.jump.longest?.km).toBeGreaterThan(500);
    expect(insights.jump.longest?.km).toBeLessThan(510);
  });

  it("opens the two visits the jump runs between, and nothing without a jump", () => {
    const from = visit("2024-05-01T10:00:00Z");
    const to = visit("2024-05-03T10:00:00Z");
    const { items } = computePlaceInsights(
      [place("ber", [from]), place("muc", [to], { lat: 48.137, lon: 11.575 })],
      NOW
    );
    expect(items.placeLongestJumpVisits.map((i) => i.entry.id)).toEqual([from.id, to.id]);
    expect(
      computePlaceInsights([place("ber", [visit("2024-05-01T10:00:00Z")])], NOW).items
        .placeLongestJumpVisits
    ).toEqual([]);
  });

  it("skips two visits on one day that carry no time — their order is unknown", () => {
    const dayOnly = { visitedPrecision: "day" };
    const { insights } = computePlaceInsights(
      [
        place("ber", [visit("2024-05-01T10:00:00Z", dayOnly)]),
        place("muc", [visit("2024-05-01T12:00:00Z", dayOnly)], { lat: 48.137, lon: 11.575 }),
      ],
      NOW
    );
    expect(insights.jump.longest).toBeNull();
    expect(insights.jump.uncertainPairs).toBe(1);
  });
});
