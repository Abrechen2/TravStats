import { describe, expect, it } from "vitest";
import { rentalSummaryFigures } from "../rentalSummaryFigures";

const labels = {
  rentals: (n: number) => `rentals/${n}`,
  days: (n: number) => `days/${n}`,
  providers: (n: number) => `providers/${n}`,
};

describe("rentalSummaryFigures", () => {
  it("counts rows, rental days and providers ignoring case", () => {
    const figures = rentalSummaryFigures(
      [
        { provider: "Sixt", rentalDays: 4, status: "completed" },
        { provider: "sixt ", rentalDays: 2, status: "scheduled" },
        { provider: "Avis", rentalDays: 3, status: "in_progress" },
      ],
      labels
    );
    expect(figures.map((f) => f.value)).toEqual(["3", "9", "2"]);
    expect(figures[1].label).toBe("days/9");
  });

  it("does not count a cancelled booking's span as rental days", () => {
    const figures = rentalSummaryFigures(
      [
        { provider: "Sixt", rentalDays: 4, status: "cancelled" },
        { provider: "Avis", rentalDays: 1, status: "completed" },
      ],
      labels
    );
    expect(figures.find((f) => f.key === "days")?.value).toBe("1");
    expect(figures.find((f) => f.key === "rentals")?.value).toBe("2");
  });
});
