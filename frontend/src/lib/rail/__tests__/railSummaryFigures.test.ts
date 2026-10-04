import { describe, it, expect } from "vitest";
import { railSummaryFigures } from "../railSummaryFigures";

/**
 * The strip formats what the server counted over the whole filtered list
 * (`backend/src/shared/listSummary.ts`, where the counting rule and its tests
 * live). Counted from the rows on screen it described one page of a paged list.
 */
const labels = {
  journeys: (n: number) => (n === 1 ? "Fahrt" : "Fahrten"),
  operators: (n: number) => (n === 1 ? "Bahngesellschaft" : "Bahngesellschaften"),
  stations: (n: number) => (n === 1 ? "Bahnhof" : "Bahnhöfe"),
  withoutOperator: (n: number) => `${n} without an operator`,
};

describe("railSummaryFigures", () => {
  it("shows the server's figures for the whole filtered list", () => {
    const figures = railSummaryFigures(
      { journeys: 312, operators: 4, withoutOperator: 0, stations: 57 },
      labels
    );
    expect(figures.map((f) => [f.value, f.label])).toEqual([
      ["312", "Fahrten"],
      ["4", "Bahngesellschaften"],
      ["57", "Bahnhöfe"],
    ]);
    expect(figures[1].note).toBeUndefined();
  });

  it("says how many trains carry no operator rather than hiding them", () => {
    const figures = railSummaryFigures(
      { journeys: 3, operators: 1, withoutOperator: 2, stations: 4 },
      labels
    );
    expect(figures[1].note).toBe("2 without an operator");
  });

  it("names a single ride in the singular — '1 Fahrten' was the bug", () => {
    const figures = railSummaryFigures(
      { journeys: 1, operators: 1, withoutOperator: 0, stations: 2 },
      labels
    );
    expect(figures.map((f) => `${f.value} ${f.label}`)).toEqual([
      "1 Fahrt",
      "1 Bahngesellschaft",
      "2 Bahnhöfe",
    ]);
  });

  it("reports no distance figure at all", () => {
    const figures = railSummaryFigures(
      { journeys: 2, operators: 1, withoutOperator: 0, stations: 3 },
      labels
    );
    expect(figures.some((f) => /km|distan|strecke/i.test(f.label + f.key))).toBe(false);
  });
});
