import { roadtripCosts, type CostExpense } from "../roadtripCosts";

const stops = [
  { id: "oslo", viaPoint: false },
  { id: "bend", viaPoint: true },
  { id: "lom", viaPoint: false },
  { id: "geiranger", viaPoint: false },
];

const expense = (over: Partial<CostExpense>): CostExpense => ({
  stopId: null,
  legFromStopId: null,
  legToStopId: null,
  amount: 10,
  currency: "NOK",
  ...over,
});

describe("roadtripCosts — the money per station, per leg and in total", () => {
  it("sums a station's expenses per currency", () => {
    const costs = roadtripCosts(
      stops,
      [
        expense({ stopId: "lom", amount: 250 }),
        expense({ stopId: "lom", amount: 30, currency: "EUR" }),
        expense({ stopId: "lom", amount: 50 }),
      ],
      "EUR"
    );
    expect(costs.byStation).toEqual([{ stopId: "lom", byCurrency: { NOK: 300, EUR: 30 } }]);
    expect(costs.total).toEqual({ NOK: 300, EUR: 30 });
    expect(costs.unpinned).toEqual({});
  });

  it("reports a toll recorded up to a route correction on the station-to-station leg", () => {
    const costs = roadtripCosts(
      stops,
      [
        expense({ legFromStopId: "oslo", legToStopId: "bend", amount: 40 }),
        expense({ legFromStopId: "bend", legToStopId: "lom", amount: 2 }),
      ],
      "EUR"
    );
    expect(costs.byLeg).toEqual([{ fromStopId: "oslo", toStopId: "lom", byCurrency: { NOK: 42 } }]);
  });

  it("keeps a leg whose station was deleted in the total, as unpinned", () => {
    // SetNull cleared one end when its station went.
    const costs = roadtripCosts(
      stops,
      [
        expense({ legFromStopId: null, legToStopId: "lom", amount: 99, currency: "EUR" }),
        expense({ amount: 5 }),
      ],
      "EUR"
    );
    expect(costs.byLeg).toEqual([]);
    expect(costs.unpinned).toEqual({ EUR: 99, NOK: 5 });
    expect(costs.total).toEqual({ EUR: 99, NOK: 5 });
  });

  it("does not place a leg whose ends no longer face each other after a reorder", () => {
    const costs = roadtripCosts(
      stops,
      [expense({ legFromStopId: "geiranger", legToStopId: "oslo", amount: 7 })],
      "EUR"
    );
    expect(costs.byLeg).toEqual([]);
    expect(costs.unpinned).toEqual({ NOK: 7 });
  });

  it("answers empty sums, not zeros, for a roadtrip with no expense", () => {
    expect(roadtripCosts(stops, [], "EUR")).toEqual({
      total: {},
      totalBase: { currency: "EUR", amount: 0, unconverted: {} },
      byStation: [],
      byLeg: [],
      unpinned: {},
    });
  });

  it("adds up in the base currency only through recorded rates", () => {
    const costs = roadtripCosts(
      stops,
      [
        expense({ amount: 30, currency: "EUR" }),
        expense({ amount: 1000, fx: { amountBase: 86.5, baseCurrency: "EUR" } }),
        // A rate into a base the user has since left converts nothing here.
        expense({ amount: 200, fx: { amountBase: 180, baseCurrency: "CHF" } }),
        expense({ amount: 50, currency: "SEK" }),
      ],
      "EUR"
    );
    expect(costs.totalBase).toEqual({
      currency: "EUR",
      amount: 116.5,
      unconverted: { NOK: 200, SEK: 50 },
    });
    expect(costs.total).toEqual({ EUR: 30, NOK: 1200, SEK: 50 });
  });
});
