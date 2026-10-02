import { describe, it, expect } from "vitest";
import { railSummaryFigures } from "../railSummaryFigures";
import type { RailJourney } from "../../../types/rail";

/** Count-aware, like `t()` with `{ count }` (forgejo#160). */
const plural = (one: string, other: string) => (count: number) => (count === 1 ? one : other);
const LABELS = {
  journeys: plural("Journey", "Journeys"),
  operators: plural("Operator", "Operators"),
  stations: plural("Station", "Stations"),
  withoutOperator: (count: number) => `${count} without an operator`,
};

function ride(over: Partial<RailJourney>): RailJourney {
  return {
    depStationName: "Köln Hbf",
    arrStationName: "Berlin Hbf",
    operator: "DB Fernverkehr",
    ...over,
  } as RailJourney;
}

describe("railSummaryFigures", () => {
  it("counts rows, recorded operators and the stations at both ends", () => {
    const figures = railSummaryFigures(
      [
        ride({}),
        ride({ depStationName: "Berlin Hbf", arrStationName: "Hamburg Hbf" }),
        ride({ operator: "ÖBB", depStationName: "Wien Hbf", arrStationName: "München Hbf" }),
      ],
      LABELS
    );
    expect(figures.map((f) => [f.label, f.value])).toEqual([
      ["Journeys", "3"],
      ["Operators", "2"],
      // Köln, Berlin, Hamburg, Wien, München
      ["Stations", "5"],
    ]);
  });

  it("treats the same operator written differently as one", () => {
    const figures = railSummaryFigures(
      [ride({ operator: "ÖBB" }), ride({ operator: "öbb" })],
      LABELS
    );
    expect(figures[1].value).toBe("1");
  });

  /**
   * The count counts what a row RECORDS. A ride with no operator is not
   * guessed at from its train number, and the figure says how many it left
   * out rather than letting "3 journeys · 1 operators" read as a contradiction
   * — the same sentence the airline figure carries.
   */
  it("says how many rides it left out, rather than guessing an operator", () => {
    const figures = railSummaryFigures(
      [ride({}), ride({ operator: null as unknown as string }), ride({ operator: "  " })],
      LABELS
    );
    expect(figures[1].value).toBe("1");
    expect(figures[1].note).toBe("2 without an operator");
  });

  it("carries no note when every ride records one", () => {
    const figures = railSummaryFigures([ride({}), ride({})], LABELS);
    expect(figures[1].note).toBeUndefined();
  });

  /**
   * Distance is absent on purpose: a ride logged without a traced line carries
   * the great-circle chord, and summing that with measured kilometres would
   * present a mix as one measured number. Pinned so nobody adds it back
   * without reading why.
   */
  it("reports no distance figure at all", () => {
    const figures = railSummaryFigures([ride({ distanceKm: 423 } as Partial<RailJourney>)], LABELS);
    expect(figures.some((f) => /km|distan|strecke/i.test(f.label + f.key))).toBe(false);
  });

  it("counts nothing from an empty list without throwing", () => {
    const figures = railSummaryFigures([], LABELS);
    expect(figures.map((f) => f.value)).toEqual(["0", "0", "0"]);
  });
});

describe("railSummaryFigures labels (forgejo#160)", () => {
  it("names a single ride in the singular — '1 Fahrten' was the bug", () => {
    const figures = railSummaryFigures([ride({})], LABELS);
    expect(figures.map((f) => `${f.value} ${f.label}`)).toEqual([
      "1 Journey",
      "1 Operator",
      "2 Stations",
    ]);
  });
});
