import { describe, expect, it } from "vitest";
import type { Place } from "../../../types/place";
import { nearbyPlaces, widerRadius } from "../placesNearbyModel";

/** Saved places around a start (forgejo#233): radius, category, state, nearest first. */
const place = (id: string, lat: number, lon: number, over: Partial<Place> = {}): Place =>
  ({
    id,
    name: id,
    category: "landmark",
    lat,
    lon,
    visited: false,
    plannedVisitCount: 0,
    ...over,
  }) as Place;

// Around the Wartburg; 0.01° of latitude is about 1.1 km.
const ORIGIN = { lat: 50.9661, lon: 10.3064 };
const ALL = new Set(["visited", "planned", "excluded"] as const);

describe("nearbyPlaces", () => {
  const places = [
    place("far", 51.1, 10.3064, { visited: true }),
    place("mid", 50.9861, 10.3064, { category: "restaurant", plannedVisitCount: 1 }),
    place("near", 50.9671, 10.3064, { visited: true }),
    place("saved", 50.9761, 10.3064),
  ];

  it("keeps what lies within the radius, nearest first", () => {
    const rows = nearbyPlaces(places, ORIGIN, { radiusKm: 5, category: "all", states: ALL });
    expect(rows.map((r) => r.place.id)).toEqual(["near", "saved", "mid"]);
    expect(rows[0].km).toBeCloseTo(0.11, 1);
  });

  it("tells visited, planned and saved apart through the counting rule", () => {
    const rows = nearbyPlaces(places, ORIGIN, { radiusKm: 5, category: "all", states: ALL });
    expect(Object.fromEntries(rows.map((r) => [r.place.id, r.state]))).toEqual({
      near: "visited",
      saved: "excluded",
      // A wishlist entry with a dated future visit is planned, not merely saved.
      mid: "planned",
    });
  });

  it("filters by category and by state", () => {
    expect(
      nearbyPlaces(places, ORIGIN, { radiusKm: 5, category: "restaurant", states: ALL }).map(
        (r) => r.place.id
      )
    ).toEqual(["mid"]);
    expect(
      nearbyPlaces(places, ORIGIN, {
        radiusKm: 5,
        category: "all",
        states: new Set(["excluded"] as const),
      }).map((r) => r.place.id)
    ).toEqual(["saved"]);
  });

  it("offers the next radius up, and none past the largest", () => {
    expect(widerRadius(5)).toBe(10);
    expect(widerRadius(0.5)).toBe(1);
    expect(widerRadius(50)).toBeNull();
  });
});
