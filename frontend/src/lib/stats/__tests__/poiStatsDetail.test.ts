import { describe, it, expect } from "vitest";

import { derivePoiStats, longestRunOfDays } from "../poiStatsDetail";
import { PLACE_CATEGORIES } from "../../../shared/placeCategories";
import type { Place, PlaceVisit } from "../../../types/place";

const NOW = new Date("2026-08-29T00:00:00Z");

const visit = (over: Partial<PlaceVisit>): PlaceVisit =>
  ({
    id: `v${Math.random()}`,
    placeId: "p",
    tripId: null,
    visitedAt: null,
    orderIdx: 0,
    notes: null,
    rating: null,
    createdAt: "2020-01-01",
    updatedAt: "2020-01-01",
    ...over,
  }) as PlaceVisit;

const place = (over: Partial<Place> & { id: string; name: string }): Place =>
  ({
    category: "restaurant",
    lat: 41.9,
    lon: 12.48,
    address: null,
    city: "Rom",
    country: "Italien",
    isoCountryCode: "IT",
    externalRef: null,
    curatedItemId: null,
    visited: true,
    notes: null,
    dataSource: null,
    createdAt: "2020-01-01",
    updatedAt: "2020-01-01",
    visits: [],
    visitCount: 0,
    ...over,
  }) as unknown as Place;

describe("derivePoiStats", () => {
  it("counts an undated visit in the total and on no day", () => {
    // The rule the whole page rests on. Dropping it would make the total
    // disagree with the places list; dating it would invent a fact.
    const d = derivePoiStats(
      [
        place({
          id: "p1",
          name: "Trevi",
          visits: [visit({ visitedAt: "2023-04-01" }), visit({ visitedAt: null })],
        }),
      ],
      PLACE_CATEGORIES.length,
      NOW
    );

    expect(d.visitsTotal).toBe(2);
    expect(d.visitsDated).toBe(1);
    expect(d.visitsUndated).toBe(1);
    expect(d.byYear).toEqual([{ year: 2023, visits: 1 }]);
  });

  it("treats an unreadable date as undated rather than as a day", () => {
    const d = derivePoiStats(
      [place({ id: "p1", name: "X", visits: [visit({ visitedAt: "nicht ein datum" })] })],
      PLACE_CATEGORIES.length,
      NOW
    );

    expect(d.visitsTotal).toBe(1);
    expect(d.visitsUndated).toBe(1);
    expect(d.byYear).toEqual([]);
  });

  it("leaves a wishlist entry out of the visited places and says how many", () => {
    const d = derivePoiStats(
      [
        place({ id: "p1", name: "Kolosseum", visits: [visit({ visitedAt: "2023-04-01" })] }),
        place({ id: "p2", name: "Sagrada", visited: false, visits: [] }),
      ],
      PLACE_CATEGORIES.length,
      NOW
    );

    expect(d.visitedPlaces.map((p) => p.id)).toEqual(["p1"]);
    expect(d.wishlistCount).toBe(1);
  });

  it("indexes the week the way the flight page does", () => {
    // 2023-04-03 was a Monday, so it belongs at index 1 of a SUNDAY-first week.
    // The flight statistics index getDay() straight into stats:weekdays.*, and
    // two pages disagreeing about the order is worse than either order.
    const d = derivePoiStats(
      [place({ id: "p1", name: "X", visits: [visit({ visitedAt: "2023-04-03" })] })],
      PLACE_CATEGORIES.length,
      NOW
    );

    expect(d.byWeekday[1]).toBe(1);
    expect(d.byWeekday[0]).toBe(0);
    expect(d.byWeekday.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("finds the day with the most distinct places, not the most visits", () => {
    const d = derivePoiStats(
      [
        place({
          id: "p1",
          name: "Trevi",
          // Three visits to ONE place on one day is one place on that day.
          visits: [
            visit({ visitedAt: "2023-04-01T09:00:00Z" }),
            visit({ visitedAt: "2023-04-01T13:00:00Z" }),
            visit({ visitedAt: "2023-04-01T19:00:00Z" }),
          ],
        }),
        place({ id: "p2", name: "Kolosseum", visits: [visit({ visitedAt: "2023-04-02" })] }),
        place({ id: "p3", name: "Pantheon", visits: [visit({ visitedAt: "2023-04-02" })] }),
      ],
      PLACE_CATEGORIES.length,
      NOW
    );

    expect(d.busiestDay).toEqual({ date: "2023-04-02", places: 2 });
  });

  it("averages the ratings that exist, and does not read an unrated visit as zero", () => {
    const d = derivePoiStats(
      [
        place({
          id: "p1",
          name: "Trevi",
          visits: [
            visit({ visitedAt: "2023-04-01", rating: 5 }),
            visit({ visitedAt: "2023-05-01" }),
          ],
        }),
        place({
          id: "p2",
          name: "Kolosseum",
          visits: [visit({ visitedAt: "2023-04-02", rating: 3 })],
        }),
      ],
      PLACE_CATEGORIES.length,
      NOW
    );

    expect(d.ratedVisits).toBe(2);
    expect(d.averageRating).toBe(4);
    expect(d.bestRated[0]).toMatchObject({ name: "Trevi", rating: 5 });
  });

  it("names the extremes by latitude", () => {
    const d = derivePoiStats(
      [
        place({
          id: "p1",
          name: "Tromsø",
          lat: 69.6,
          visits: [visit({ visitedAt: "2023-01-01" })],
        }),
        place({
          id: "p2",
          name: "Ushuaia",
          lat: -54.8,
          visits: [visit({ visitedAt: "2023-01-02" })],
        }),
      ],
      PLACE_CATEGORIES.length,
      NOW
    );

    expect(d.northernmost?.name).toBe("Tromsø");
    expect(d.southernmost?.name).toBe("Ushuaia");
  });

  it("says how much of the category catalogue has been used", () => {
    const d = derivePoiStats(
      [
        place({
          id: "p1",
          name: "A",
          category: "museum",
          visits: [visit({ visitedAt: "2023-01-01" })],
        }),
        place({
          id: "p2",
          name: "B",
          category: "nature",
          visits: [visit({ visitedAt: "2023-01-02" })],
        }),
      ],
      PLACE_CATEGORIES.length,
      NOW
    );

    expect(d.categoryCoverage).toEqual({ used: 2, total: PLACE_CATEGORIES.length });
  });

  it("survives a place with no visits at all", () => {
    const d = derivePoiStats(
      [place({ id: "p1", name: "Marked visited, never dated", visits: [] })],
      PLACE_CATEGORIES.length,
      NOW
    );

    expect(d.visitedPlaces).toHaveLength(1);
    expect(d.visitsTotal).toBe(0);
    expect(d.firstVisit).toBeNull();
    expect(d.busiestDay).toBeNull();
    expect(d.longestStreakDays).toBeNull();
    expect(d.averageRating).toBeNull();
  });
});

describe("longestRunOfDays", () => {
  it("counts consecutive calendar days", () => {
    expect(longestRunOfDays(["2023-04-01", "2023-04-02", "2023-04-03", "2023-05-01"])).toBe(3);
  });

  it("is not fooled by a month or year boundary", () => {
    expect(longestRunOfDays(["2023-12-31", "2024-01-01"])).toBe(2);
    expect(longestRunOfDays(["2023-01-31", "2023-02-01"])).toBe(2);
  });

  it("counts a lone day as one, and nothing as nothing", () => {
    expect(longestRunOfDays(["2023-04-01"])).toBe(1);
    expect(longestRunOfDays([])).toBeNull();
  });

  it("ignores a repeated day", () => {
    expect(longestRunOfDays(["2023-04-01", "2023-04-01", "2023-04-02"])).toBe(2);
  });
});
