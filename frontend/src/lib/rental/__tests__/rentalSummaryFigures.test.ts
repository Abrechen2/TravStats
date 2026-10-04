import { describe, expect, it } from "vitest";
import { rentalSummaryFigures } from "../rentalSummaryFigures";

/** Formats the server's count over the whole filtered list (`backend/src/shared/listSummary.ts`). */
const labels = {
  rentals: (n: number) => `rentals/${n}`,
  days: (n: number) => `days/${n}`,
  providers: (n: number) => `providers/${n}`,
};

describe("rentalSummaryFigures", () => {
  it("shows rentals, rental days and providers as the server counted them", () => {
    const figures = rentalSummaryFigures({ rentals: 120, days: 431, providers: 6 }, labels);
    expect(figures.map((f) => f.value)).toEqual(["120", "431", "6"]);
    expect(figures[1].label).toBe("days/431");
  });
});
