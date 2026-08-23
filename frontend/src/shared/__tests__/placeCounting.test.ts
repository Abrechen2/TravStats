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
    expect(countCompletedVisits([{ visitedAt: PAST }, { visitedAt: FUTURE }, { visitedAt: null }])).toBe(2);
  });
});
