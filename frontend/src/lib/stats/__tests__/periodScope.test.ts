import { describe, it, expect } from "vitest";
import { cruisesStartedIn, placesVisitedIn } from "../periodScope";
import { visitCountsForYear } from "../../../shared/placeCounting";
import type { Cruise } from "../../../types/cruise";
import type { Place, PlaceVisit } from "../../../types/place";

const cruise = (id: string, startDate: string | null): Cruise =>
  ({ id, startDate }) as unknown as Cruise;

const visit = (id: string, visitedAt: string | null): PlaceVisit =>
  ({ id, visitedAt }) as unknown as PlaceVisit;

const place = (id: string, visited: boolean, visits: PlaceVisit[]): Place =>
  ({ id, visited, visits, plannedVisitCount: 0 }) as unknown as Place;

describe("cruisesStartedIn", () => {
  it("places a cruise over New Year in the year it sailed from", () => {
    const rows = [cruise("nye", "2023-12-30T00:00:00.000Z")];
    expect(cruisesStartedIn(rows, 2023).map((c) => c.id)).toEqual(["nye"]);
    expect(cruisesStartedIn(rows, 2024)).toEqual([]);
  });

  it("reads the year in UTC, as the server's window does", () => {
    // 23:30 on New Year's Eve UTC is already 2025 in Berlin. The server counts
    // it in 2024; a local-time reading would put the tab one year off.
    const rows = [cruise("late", "2024-12-31T23:30:00.000Z")];
    expect(cruisesStartedIn(rows, 2024).map((c) => c.id)).toEqual(["late"]);
  });

  it("drops a cruise with no start date from every year", () => {
    expect(cruisesStartedIn([cruise("undated", null)], 2024)).toEqual([]);
  });
});

describe("placesVisitedIn", () => {
  const NOW = new Date("2026-06-01T12:00:00.000Z");

  it("keeps a place with a visit in the year, carrying only that year's visits", () => {
    const rows = [
      place("p", true, [visit("a", "2024-05-01T10:00:00Z"), visit("b", "2025-05-01T10:00:00Z")]),
    ];
    const scoped = placesVisitedIn(rows, 2024, NOW);
    expect(scoped.map((p) => p.id)).toEqual(["p"]);
    expect(scoped[0].visits.map((v) => v.id)).toEqual(["a"]);
  });

  it("does not change the rows it was given", () => {
    const rows = [
      place("p", true, [visit("a", "2024-05-01T10:00:00Z"), visit("b", "2025-05-01T10:00:00Z")]),
    ];
    placesVisitedIn(rows, 2024, NOW);
    expect(rows[0].visits).toHaveLength(2);
  });

  it("leaves out a wishlist entry, even with a dated visit attached", () => {
    const rows = [place("wish", false, [visit("a", "2024-05-01T10:00:00Z")])];
    expect(placesVisitedIn(rows, 2024, NOW)).toEqual([]);
  });

  it("leaves out a place visited on no known date", () => {
    const rows = [place("undated", true, [visit("a", null)]), place("bare", true, [])];
    expect(placesVisitedIn(rows, 2024, NOW)).toEqual([]);
  });

  it("does not count a visit dated later this year", () => {
    const rows = [place("soon", true, [visit("a", "2026-09-01T10:00:00Z")])];
    expect(placesVisitedIn(rows, 2026, NOW)).toEqual([]);
  });
});

/**
 * The year window is `shared/placeCounting.ts`'s rule, not this module's — it
 * moved there in task 7b-3 so the evidence panel could cut the same rows the
 * same way. This pins the fold to the mirror: a `placesVisitedIn` that stopped
 * calling it, or a `visitCountsForYear` that changed underneath, would show up
 * here as a disagreement rather than as a panel quietly naming a visit the tab
 * never counted.
 */
describe("placesVisitedIn answers exactly what the shared rule says", () => {
  it("keeps precisely the visits visitCountsForYear keeps", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const visits = [
      visit("in", "2024-06-01T00:00:00.000Z"),
      visit("other-year", "2025-06-01T00:00:00.000Z"),
      visit("undated", null),
      visit("future", "2099-06-01T00:00:00.000Z"),
    ];
    const rows = [place("p", true, visits)];

    const kept = placesVisitedIn(rows, 2024, now)[0]?.visits.map((v) => v.id) ?? [];
    const expected = visits.filter((v) => visitCountsForYear(v, 2024, now)).map((v) => v.id);
    expect(kept).toEqual(expected);
    // Stated as a literal too, so the assertion above cannot pass vacuously
    // when both sides agree on the empty set.
    expect(kept).toEqual(["in"]);
  });

  it("drops a place whose only visits the rule rejects", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const rows = [place("p", true, [visit("undated", null)])];
    expect(placesVisitedIn(rows, 2024, now)).toEqual([]);
  });
});
