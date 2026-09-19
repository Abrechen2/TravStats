/**
 * The three states a place can be in, and the two rules that decide them.
 *
 * The file this tests is MIRRORED to the backend. Both copies must agree, so
 * the cases here are written against the rules in its header rather than
 * against either implementation.
 */
import { describe, it, expect } from "vitest";
import {
  classifyPlace,
  classifyVisit,
  countCompletedVisits,
  countVisitedPlaces,
  countPlaceCountries,
  visitCountsForYear,
  visitYear,
} from "../placeCounting";

const PAST = "2020-05-01T10:00:00.000Z";
const FUTURE = "2099-05-01T10:00:00.000Z";

describe("classifyPlace", () => {
  it("is visited when the logbook flag is set, whatever the visits say", () => {
    // "I have definitely been to that Maccis, no idea when."
    expect(classifyPlace({ visited: true })).toBe("visited");
    expect(classifyPlace({ visited: true, plannedVisitCount: 3 })).toBe("visited");
  });

  it("is planned when a dated future visit points at it", () => {
    // The same distinction a flight before departure and a stay before
    // check-in already carry — derived from the date, never stored.
    expect(classifyPlace({ visited: false, plannedVisitCount: 1 })).toBe("planned");
  });

  it("is a bare wishlist entry with no visits ahead", () => {
    expect(classifyPlace({ visited: false })).toBe("excluded");
    expect(classifyPlace({ visited: false, plannedVisitCount: 0 })).toBe("excluded");
  });
});

describe("classifyVisit", () => {
  it("counts an UNDATED visit as one that happened", () => {
    // Nobody enters a plan without a date. Treating the gap as "planned"
    // would drop real history out of every total.
    expect(classifyVisit({ visitedAt: null })).toBe("visited");
  });

  it("does not count a future visit", () => {
    expect(classifyVisit({ visitedAt: FUTURE })).toBe("planned");
  });

  it("counts a past visit", () => {
    expect(classifyVisit({ visitedAt: PAST })).toBe("visited");
  });
});

describe("the totals are unmoved by the new state", () => {
  // The planned state must not leak into any figure. A place you intend to
  // visit is not a place you have visited, and the headline number was the
  // reason `Place.visited` defaults to false in the first place.
  const places = [
    { visited: true, isoCountryCode: "IT" },
    { visited: false, plannedVisitCount: 2, isoCountryCode: "FR" },
    { visited: false, isoCountryCode: "ES" },
  ];

  it("counts only places that happened", () => {
    expect(countVisitedPlaces(places)).toBe(1);
  });

  it("counts only countries of places that happened", () => {
    expect(countPlaceCountries(places)).toBe(1);
  });

  it("counts only visits that happened", () => {
    expect(
      countCompletedVisits([{ visitedAt: PAST }, { visitedAt: FUTURE }, { visitedAt: null }])
    ).toBe(2);
  });
});

/**
 * The year rule, added in task 7b-3 when it moved here out of
 * `lib/stats/periodScope.ts` so the evidence panel could cut the same rows the
 * places tab does. Its backend mirror asserts the same table.
 */
describe("visitYear", () => {
  it("reads the year in UTC, as every other domain's window does", () => {
    // 23:30 on New Year's Eve UTC is already the next year in Berlin.
    expect(visitYear({ visitedAt: "2024-12-31T23:30:00.000Z" })).toBe(2024);
  });

  it("has no year for an undated or unreadable visit", () => {
    expect(visitYear({ visitedAt: null })).toBeNull();
    expect(visitYear({ visitedAt: "not a date" })).toBeNull();
  });
});

describe("visitCountsForYear", () => {
  const NOW = new Date("2026-01-01T00:00:00.000Z");

  it("keeps a dated visit that happened, in its own year and no other", () => {
    expect(visitCountsForYear({ visitedAt: PAST }, 2020, NOW)).toBe(true);
    expect(visitCountsForYear({ visitedAt: PAST }, 2021, NOW)).toBe(false);
  });

  it("refuses an undated visit every year, although it counts in the total", () => {
    expect(classifyVisit({ visitedAt: null }, NOW)).toBe("visited");
    expect(visitCountsForYear({ visitedAt: null }, 2020, NOW)).toBe(false);
  });

  it("refuses a visit dated later this year, so a year cannot run ahead", () => {
    const later = "2026-09-01T00:00:00.000Z";
    expect(visitYear({ visitedAt: later })).toBe(2026);
    expect(visitCountsForYear({ visitedAt: later }, 2026, NOW)).toBe(false);
  });
});
