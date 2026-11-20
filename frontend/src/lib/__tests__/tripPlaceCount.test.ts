import { describe, it, expect } from "vitest";
import { countTripPlaces, countPlacesByTrip } from "../tripPlaceCount";

const NOW = new Date("2026-06-01T12:00:00Z");
const past = { visitedAt: "2026-05-01T10:00:00Z" };
const future = { visitedAt: "2026-07-01T10:00:00Z" };

describe("countTripPlaces", () => {
  it("counts a place once however many times it was visited", () => {
    const p = { id: "a" };
    expect(
      countTripPlaces(
        [
          { place: p, visit: past },
          { place: p, visit: past },
        ],
        NOW
      )
    ).toBe(1);
  });

  it("does not count a place that is only planned for the trip", () => {
    expect(
      countTripPlaces(
        [
          { place: { id: "a" }, visit: future },
          { place: { id: "b" }, visit: past },
        ],
        NOW
      )
    ).toBe(1);
  });

  it("counts an undated visit, which happened but cannot be dated", () => {
    expect(countTripPlaces([{ place: { id: "a" }, visit: { visitedAt: null } }], NOW)).toBe(1);
  });
});

describe("countPlacesByTrip", () => {
  it("counts per trip, distinct places, visited only", () => {
    const places = [
      {
        id: "a",
        visits: [
          { tripId: "t1", ...past },
          { tripId: "t2", ...past },
        ],
      },
      { id: "b", visits: [{ tripId: "t1", ...future }] },
      {
        id: "c",
        visits: [
          { tripId: "t1", ...past },
          { tripId: null, ...past },
        ],
      },
    ] as never;
    const map = countPlacesByTrip(places, NOW);
    expect(map.get("t1")).toBe(2);
    expect(map.get("t2")).toBe(1);
    expect(map.has("t3")).toBe(false);
  });
});
