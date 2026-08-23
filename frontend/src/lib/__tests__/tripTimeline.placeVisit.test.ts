import { describe, it, expect } from "vitest";
import { compareTimelineEvents, isSupersededByPlaceVisit } from "../tripTimeline";

/**
 * The POI backfill copies `TripStop{domain:'poi'}` rows into Place +
 * PlaceVisit and leaves the originals behind (expand/contract). Between the
 * copy release and the delete release BOTH rows exist, so the timeline needs a
 * rule for which one it draws. Getting this wrong shows every migrated POI
 * twice — visible to the user on their very first look after upgrading.
 */
describe("isSupersededByPlaceVisit: which trip stops the backfill replaced", () => {
  it("suppresses a POI stop that HAD coordinates — the migration took it", () => {
    expect(isSupersededByPlaceVisit({ domain: "poi", lat: 41.9, lon: 12.49 })).toBe(true);
  });

  it("keeps a POI stop WITHOUT coordinates — the migration deliberately skipped it", () => {
    // places.lat/lon is NOT NULL, so these rows could not be migrated; deleting
    // them to satisfy the schema would have destroyed the user's own text.
    expect(isSupersededByPlaceVisit({ domain: "poi", lat: null, lon: null })).toBe(false);
    expect(isSupersededByPlaceVisit({ domain: "poi", lat: 41.9, lon: null })).toBe(false);
    expect(isSupersededByPlaceVisit({ domain: "poi", lat: null, lon: 12.49 })).toBe(false);
    expect(isSupersededByPlaceVisit({ domain: "poi" })).toBe(false);
  });

  it("never touches another domain's stop", () => {
    // TripStop stays the generic timeline primitive; only domain='poi' moved.
    for (const domain of ["hotel", "train", "hike", "road", "ferry", null, undefined]) {
      expect(isSupersededByPlaceVisit({ domain, lat: 41.9, lon: 12.49 })).toBe(false);
    }
  });
});

/**
 * #175 was fixed against TripStop and must survive the move to PlaceVisit:
 * several places on the same day still sort by time of day, and the journal
 * entry is still the day's last word.
 */
describe("place-visit events keep the #175 ordering", () => {
  it("orders three place visits on one day by time, journal last", () => {
    const events = [
      { id: "j", kind: "journal", date: "2025-05-03T00:00:00.000Z" },
      { id: "c", kind: "place-visit", date: "2025-05-03T14:30:00.000Z" },
      { id: "a", kind: "place-visit", date: "2025-05-03T10:00:00.000Z" },
      { id: "b", kind: "place-visit", date: "2025-05-03T12:30:00.000Z" },
    ];
    expect([...events].sort(compareTimelineEvents).map((e) => e.id)).toEqual([
      "a",
      "b",
      "c",
      "j",
    ]);
  });

  it("does not drag a visit across a day boundary", () => {
    const events = [
      { id: "day2-early", kind: "place-visit", date: "2025-05-04T09:00:00.000Z" },
      { id: "day1-late", kind: "place-visit", date: "2025-05-03T22:00:00.000Z" },
    ];
    expect([...events].sort(compareTimelineEvents).map((e) => e.id)).toEqual([
      "day1-late",
      "day2-early",
    ]);
  });
});
