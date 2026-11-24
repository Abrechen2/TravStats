import { describe, expect, it } from "vitest";
import { placesInRange, toursInRange } from "../dashboardYearFilter";
import type { Place } from "../../../types/place";

const year2024 = { from: "2024-01-01", to: "2024-12-31" };
const open = { from: null, to: null };

describe("the map's year filter on the tour, roadtrip and POI tabs", () => {
  const tours = [
    { id: "a", startDate: "2024-03-01", endDate: "2024-03-05" },
    { id: "b", startDate: "2023-12-30", endDate: "2024-01-02" },
    { id: "c", startDate: "2022-05-01", endDate: "2022-05-02" },
    { id: "u", startDate: null, endDate: null },
  ];

  it("keeps the tours overlapping the year and the undated one, drops the others", () => {
    expect(toursInRange(tours, year2024).map((t) => t.id)).toEqual(["a", "b", "u"]);
  });

  it("an open range keeps every tour", () => {
    expect(toursInRange(tours, open)).toHaveLength(4);
  });

  const place = (id: string, visitedAt: string | null): Place =>
    ({ id, visits: [{ visitedAt }] }) as unknown as Place;

  it("keeps a place with a counted visit in the year; an undated visit steps aside", () => {
    const places = [place("in", "2024-06-10"), place("out", "2022-06-10"), place("undated", null)];
    expect(placesInRange(places, year2024).map((p) => p.id)).toEqual(["in"]);
    expect(placesInRange(places, open)).toHaveLength(3);
  });
});
