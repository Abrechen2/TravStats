import { describe, it, expect } from "vitest";
import { tripCostTotals } from "../tripCost";

/**
 * The web lays out the server's trip cost (forgejo#274) and decides nothing
 * about what an entry costs: each currency arrives once, already summed.
 */
describe("tripCostTotals", () => {
  it("lists the server's currencies EUR first, then alphabetically, never summed together", () => {
    expect(
      tripCostTotals({ spendByCurrency: { USD: 480, CHF: 210, EUR: 300 }, unpricedEntries: 0 })
    ).toEqual([
      { currency: "EUR", total: 300 },
      { currency: "CHF", total: 210 },
      { currency: "USD", total: 480 },
    ]);
  });

  it("drops a free bucket beside real money, and keeps one when free is all there is", () => {
    expect(tripCostTotals({ spendByCurrency: { EUR: 120, JPY: 0 }, unpricedEntries: 0 })).toEqual([
      { currency: "EUR", total: 120 },
    ]);
    expect(tripCostTotals({ spendByCurrency: { EUR: 0, JPY: 0 }, unpricedEntries: 0 })).toEqual([
      { currency: "EUR", total: 0 },
    ]);
  });

  it("answers nothing — never 0 — when the server sent no cost", () => {
    expect(tripCostTotals(undefined)).toEqual([]);
    expect(tripCostTotals(null)).toEqual([]);
    expect(tripCostTotals({ spendByCurrency: {}, unpricedEntries: 3 })).toEqual([]);
  });
});
