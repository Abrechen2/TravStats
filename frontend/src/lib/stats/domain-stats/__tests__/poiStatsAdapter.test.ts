import { describe, it, expect } from "vitest";
import { adaptPoi } from "../poiStatsAdapter";
import type { Place, PlaceVisit } from "../../../../types/place";
import type { CuratedListSummary, PlaceList } from "../../../../types/placeList";

const visit = (over: Partial<PlaceVisit> = {}): PlaceVisit => ({
  id: "v",
  placeId: "p",
  tripId: null,
  visitedAt: "2024-06-12T10:00:00.000Z",
  orderIdx: 0,
  notes: null,
  rating: null,
  createdAt: "2024-06-12T10:00:00.000Z",
  updatedAt: "2024-06-12T10:00:00.000Z",
  ...over,
});

const place = (over: Partial<Place> = {}): Place => ({
  id: "p",
  name: "Kolosseum",
  category: "landmark",
  lat: 41.89,
  lon: 12.49,
  address: null,
  city: "Rom",
  country: "Italy",
  isoCountryCode: "IT",
  externalRef: null,
  curatedItemId: null,
  visited: true,
  notes: null,
  dataSource: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  visits: [visit()],
  visitCount: 1,
  plannedVisitCount: 0,
  lastVisitAt: "2024-06-12T10:00:00.000Z",
  continent: "Europe",
  ...over,
});

const checklist = (over: Partial<CuratedListSummary> = {}): CuratedListSummary => ({
  key: "world-wonders-new7",
  name: "Neue 7 Weltwunder",
  nameEn: null,
  description: null,
  descriptionEn: null,
  icon: null,
  itemCount: 7,
  tickedCount: 0,
  subscribed: false,
  listId: null,
  color: null,
  ...over,
});

const emptyLists: PlaceList[] = [];

describe("adaptPoi", () => {
  it("reports no data with no argument at all — the pre-Phase-A resting state", () => {
    expect(adaptPoi()).toEqual({ domain: "poi", hasData: false });
  });

  it("reports no data when every place is a wishlist entry", () => {
    const result = adaptPoi({
      places: [place({ visited: false })],
      lists: emptyLists,
      curated: [],
    });
    expect(result.hasData).toBe(false);
  });

  it("counts PLACES and VISITS separately — the #177 split", () => {
    const result = adaptPoi({
      places: [
        place({
          id: "maccis",
          category: "restaurant",
          visits: [visit({ id: "a" }), visit({ id: "b" }), visit({ id: "c" })],
        }),
      ],
      lists: emptyLists,
      curated: [],
    });
    if (!result.hasData) throw new Error("expected data");
    // Three trips to one McDonald's: one place, three events.
    expect(result.totalEvents).toBe(3);
    expect(result.summary.headlineKpis[0]).toEqual({ label: "Orte besucht", value: 1 });
  });

  it("counts an undated visit but marks no day for it", () => {
    const result = adaptPoi({
      places: [place({ visits: [visit({ visitedAt: null })] })],
      lists: emptyLists,
      curated: [],
    });
    if (!result.hasData) throw new Error("expected data");
    expect(result.totalEvents).toBe(1);
    expect(Object.keys(result.dailyActiveDays)).toHaveLength(0);
  });

  it("excludes a future-dated visit from the event tally", () => {
    const result = adaptPoi({
      places: [
        place({
          visits: [visit({ id: "past" }), visit({ id: "later", visitedAt: "2999-01-01T00:00:00.000Z" })],
        }),
      ],
      lists: emptyLists,
      curated: [],
    });
    if (!result.hasData) throw new Error("expected data");
    expect(result.totalEvents).toBe(1);
  });

  it("picks the best checklist by SHARE, not by ticks", () => {
    // 3 of 7 beats 4 of 20 — comparing raw ticks would always crown the
    // longest list as the one closest to done.
    const result = adaptPoi({
      places: [place()],
      lists: emptyLists,
      curated: [
        checklist({ key: "short", itemCount: 7, tickedCount: 3 }),
        checklist({ key: "long", itemCount: 20, tickedCount: 4 }),
      ],
    });
    if (!result.hasData) throw new Error("expected data");
    const kpis = result.summary.headlineKpis;
    expect(kpis[kpis.length - 1]).toEqual({
      label: "Beste Checkliste",
      value: "3/7",
    });
  });

  it("omits the checklist tile entirely when nothing is on offer", () => {
    const result = adaptPoi({ places: [place()], lists: emptyLists, curated: [] });
    if (!result.hasData) throw new Error("expected data");
    expect(result.summary.headlineKpis.map((k) => k.label)).toEqual([
      "Orte besucht",
      "Länder",
      "Listen",
    ]);
  });

  it("joins countries on the ISO code", () => {
    const result = adaptPoi({
      places: [
        place({ id: "a", isoCountryCode: "IT" }),
        place({ id: "b", isoCountryCode: "it" }),
        place({ id: "c", isoCountryCode: "JP" }),
      ],
      lists: emptyLists,
      curated: [],
    });
    if (!result.hasData) throw new Error("expected data");
    expect(new Set(result.countries)).toEqual(new Set(["IT", "JP"]));
  });
});
