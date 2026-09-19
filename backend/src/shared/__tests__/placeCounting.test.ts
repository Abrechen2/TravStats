/**
 * The backend half of `shared/placeCounting.ts`'s truth table.
 *
 * The file is MIRRORED to `frontend/src/shared/placeCounting.ts`, and nothing
 * checks that the two copies agree — each side has its own test asserting the
 * same table, which is the convention in this codebase rather than a guard.
 * That side has had one since the module was written; this one gained the
 * year rule in task 7b-3, when the evidence resolver for the places tab began
 * reading it, so it gains a test here too.
 *
 * The cases are written against the rules in the module's header, not against
 * either implementation.
 */
import {
  classifyPlace,
  classifyVisit,
  countCompletedVisits,
  countPlaceCountries,
  countVisitedPlaces,
  visitCountsForYear,
  visitYear,
} from "../placeCounting";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const PAST = "2024-06-01T10:00:00.000Z";
const FUTURE = "2099-06-01T10:00:00.000Z";

describe("classifyPlace", () => {
  it("is visited when the logbook flag is set, whatever the visits say", () => {
    expect(classifyPlace({ visited: true })).toBe("visited");
    expect(classifyPlace({ visited: true, plannedVisitCount: 3 })).toBe("visited");
  });

  it("separates a bare wishlist entry from one a future visit points at", () => {
    expect(classifyPlace({ visited: false })).toBe("excluded");
    expect(classifyPlace({ visited: false, plannedVisitCount: 1 })).toBe("planned");
  });
});

describe("classifyVisit", () => {
  it("counts an undated visit — it happened, the user cannot say when", () => {
    expect(classifyVisit({ visitedAt: null }, NOW)).toBe("visited");
  });

  it("does not count a visit dated in the future", () => {
    expect(classifyVisit({ visitedAt: FUTURE }, NOW)).toBe("planned");
  });

  it("reads an unparseable date as no date at all, not as a future one", () => {
    expect(classifyVisit({ visitedAt: "not a date" }, NOW)).toBe("visited");
  });
});

describe("visitYear", () => {
  it("reads the year in UTC, as every other domain's window does", () => {
    // 23:30 on New Year's Eve UTC is already the next year in Berlin. A local
    // reading would file this visit one year off from the overview beside it.
    expect(visitYear({ visitedAt: "2024-12-31T23:30:00.000Z" })).toBe(2024);
  });

  it("has no year for an undated or unreadable visit", () => {
    expect(visitYear({ visitedAt: null })).toBeNull();
    expect(visitYear({ visitedAt: "not a date" })).toBeNull();
  });
});

describe("visitCountsForYear", () => {
  it("keeps a dated visit that happened, in its own year and no other", () => {
    expect(visitCountsForYear({ visitedAt: PAST }, 2024, NOW)).toBe(true);
    expect(visitCountsForYear({ visitedAt: PAST }, 2023, NOW)).toBe(false);
  });

  it("refuses an undated visit every year, although it counts in the total", () => {
    expect(classifyVisit({ visitedAt: null }, NOW)).toBe("visited");
    expect(visitCountsForYear({ visitedAt: null }, 2024, NOW)).toBe(false);
  });

  it("refuses a visit dated later this year, so a year cannot run ahead", () => {
    const later = "2026-09-01T00:00:00.000Z";
    expect(visitYear({ visitedAt: later })).toBe(2026);
    expect(visitCountsForYear({ visitedAt: later }, 2026, NOW)).toBe(false);
  });
});

describe("the counting helpers", () => {
  it("counts places and visits as two different questions", () => {
    const places = [
      { visited: true, isoCountryCode: "de" },
      { visited: true, isoCountryCode: "DE" },
      { visited: false, isoCountryCode: "JP" },
    ];
    expect(countVisitedPlaces(places)).toBe(2);
    // Three visits to one McDonald's is one place and three visits.
    expect(countCompletedVisits([{ visitedAt: PAST }, { visitedAt: PAST }], NOW)).toBe(2);
    // Joined on the CODE, case-folded: "de" and "DE" are one country.
    expect(countPlaceCountries(places)).toBe(1);
  });
});
