import { describe, expect, it } from "vitest";
import { tourSummaryFigures } from "../tourSummaryFigures";
import type { TourSummary } from "../../api/tourIndex";

const labels = {
  tours: (n: number) => `tours:${n}`,
  trips: (n: number) => `trips:${n}`,
  withoutTrip: (n: number) => `without:${n}`,
};
const tour = (tripId: string | null): TourSummary => ({ tripId }) as TourSummary;

describe("tourSummaryFigures", () => {
  it("counts tours and distinct trips, and notes the tours without a trip", () => {
    const figures = tourSummaryFigures([tour("a"), tour("a"), tour("b"), tour(null)], labels);
    expect(figures.map((f) => [f.key, f.value])).toEqual([
      ["tours", "4"],
      ["trips", "2"],
    ]);
    expect(figures[0].note).toBe("without:1");
  });

  it("leaves out a '0 trips' figure when no tour belongs to a trip", () => {
    const figures = tourSummaryFigures([tour(null), tour(null)], labels);
    expect(figures.map((f) => f.key)).toEqual(["tours"]);
    expect(figures[0].note).toBe("without:2");
  });
});
