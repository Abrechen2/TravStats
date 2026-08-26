import { describe, it, expect } from "vitest";
import { cruiseToItem, lodgingToItem, placeToItem, sortActivityItems } from "../activityItems";
import type { Cruise } from "../../../../types/cruise";
import type { Lodging } from "../../../../types/lodging";
import type { Place } from "../../../../types/place";

/**
 * Echoes the key it was handed instead of translating.
 *
 * Deliberately NOT a lookup table of German strings: a fake that knows the
 * copy would pass whether the mapper translated or hardcoded the same words,
 * which is how the German literals survived the first round of these tests.
 * The key coming back out is the whole proof.
 */
const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}|${JSON.stringify(options)}` : key;

const lodging = (over: Partial<Lodging> = {}): Lodging =>
  ({
    id: "l1",
    name: "Hilton Berlin",
    chain: null,
    city: "Berlin",
    country: "Deutschland",
    lat: 52.5,
    lon: 13.4,
    stays: [],
    nights: 0,
    ...over,
  }) as unknown as Lodging;

const stay = (checkIn: string | null, checkOut: string | null = null) =>
  ({ id: "s", checkIn, checkOut, datePrecision: "DAY", nights: null }) as never;

const place = (over: Partial<Place> = {}): Place =>
  ({
    id: "p1",
    name: "Sagrada Família",
    category: "sight",
    lat: 41.4,
    lon: 2.17,
    city: "Barcelona",
    country: "Spanien",
    visited: true,
    visits: [],
    visitCount: 0,
    plannedVisitCount: 0,
    lastVisitAt: null,
    ...over,
  }) as unknown as Place;

describe("lodgingToItem", () => {
  it("dates a hotel by its most recent stay", () => {
    const item = lodgingToItem(
      lodging({ stays: [stay("2024-02-01"), stay("2026-05-20"), stay("2023-08-08")] }),
      t
    );
    expect(item.sortDate).toBe("2026-05-20");
  });

  // The owner's rule: a hotel he checks into next month belongs ABOVE one he
  // left last year. So the date is the newest stay including planned ones —
  // NOT `lastVisit`-style "most recent completed".
  it("counts a planned stay as the newest one", () => {
    const item = lodgingToItem(lodging({ stays: [stay("2024-02-01"), stay("2099-01-15")] }), t);
    expect(item.sortDate).toBe("2099-01-15");
  });

  // Stays are datable-optional since 2.7. A hotel with none is still a hotel.
  it("leaves the date empty when no stay carries one", () => {
    const item = lodgingToItem(lodging({ stays: [stay(null)] }), t);
    expect(item.sortDate).toBe("");
    expect(item.displayDate).toBe("—");
  });

  it("carries city and chain as the subtitle", () => {
    const item = lodgingToItem(lodging({ chain: { id: 1, name: "Hilton" } as never }), t);
    expect(item.sublabel).toContain("Hilton");
    expect(item.sublabel).toContain("Berlin");
  });

  it("marks a hotel without coordinates as unmappable", () => {
    expect(lodgingToItem(lodging({ lat: null, lon: null }), t).mappable).toBe(false);
    expect(lodgingToItem(lodging(), t).mappable).toBe(true);
  });
});

describe("placeToItem", () => {
  // `Place.lastVisitAt` is documented as the most recent COMPLETED visit and
  // excludes future ones, so it cannot answer "newest including planned".
  it("counts a future visit as the newest one, unlike lastVisitAt", () => {
    const item = placeToItem(
      place({
        lastVisitAt: "2024-03-01T00:00:00Z",
        visits: [
          { id: "v1", visitedAt: "2024-03-01T00:00:00Z" },
          { id: "v2", visitedAt: "2099-07-04T00:00:00Z" },
        ] as never,
      }),
      t
    );
    expect(item.sortDate).toBe("2099-07-04");
  });

  it("leaves the date empty for a wishlist place with no dated visit", () => {
    const item = placeToItem(place({ visited: false, visits: [] }), t);
    expect(item.sortDate).toBe("");
  });

  // Every place has coordinates by construction (lat/lon are NOT NULL).
  it("is always mappable", () => {
    expect(placeToItem(place(), t).mappable).toBe(true);
  });
});

/**
 * The meta line and the cruise fallback title are USER-FACING COPY, and this
 * app ships German and English. The four sidebars that this mapper replaced
 * each went through `t`; the strings turned into German literals during the
 * merge into one file, which put German meta text on an English dashboard.
 * These assert the key reaches the translator — nothing about what it says.
 */
describe("meta copy goes through the translator", () => {
  const cruise = (over: Partial<Cruise> = {}): Cruise =>
    ({
      id: "c1",
      ship: null,
      shipNameOverride: null,
      cruiseLine: null,
      startDate: "2025-04-01T00:00:00Z",
      stops: [],
      ...over,
    }) as unknown as Cruise;

  it("counts a hotel's nights via the shared lodging key", () => {
    expect(lodgingToItem(lodging({ nights: 3 }), t).meta).toBe(
      'lodging:field.nightsCount|{"count":3}'
    );
  });

  it("counts a place's visits via the places key", () => {
    expect(placeToItem(place({ visitCount: 2 }), t).meta).toBe(
      'places:list.visitsCount|{"count":2}'
    );
  });

  it("labels an unvisited place as a wishlist entry via the places key", () => {
    expect(placeToItem(place({ visited: false, visitCount: 0 }), t).meta).toBe(
      "places:list.status.wishlist"
    );
  });

  it("counts a cruise's port calls via the sidebar key", () => {
    const stops = [{ isAtSea: false }, { isAtSea: true }, { isAtSea: false }] as never;
    expect(cruiseToItem(cruise({ stops }), t).meta).toBe("2 dashboard:sidebar.ports");
  });

  it("falls back to the translated cruise title, not the English word", () => {
    expect(cruiseToItem(cruise(), t).label).toBe("cruise:map.fallbackTitle");
  });
});

describe("sortActivityItems", () => {
  const it_ = (id: string, sortDate: string) =>
    ({ id, kind: "flight", label: id, sublabel: null, meta: null, sortDate, displayDate: "", mappable: true, payload: { flightId: id } }) as never;

  it("puts the newest first and undated last", () => {
    const out = sortActivityItems([
      it_("mitte", "2025-01-01"),
      it_("ohne", ""),
      it_("neu", "2026-09-09"),
      it_("alt", "2020-01-01"),
    ]);
    expect(out.map((i) => i.id)).toEqual(["neu", "mitte", "alt", "ohne"]);
  });
});
