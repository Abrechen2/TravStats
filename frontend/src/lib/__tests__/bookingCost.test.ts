import { describe, it, expect } from "vitest";
import { sumByCurrency } from "../bookingCost";

describe("sumByCurrency", () => {
  it("sums a single currency", () => {
    expect(
      sumByCurrency([
        { price: 100, currency: "EUR" },
        { price: 50, currency: "EUR" },
      ])
    ).toEqual([{ currency: "EUR", total: 150 }]);
  });

  it("keeps currencies separate, EUR first, rest alphabetical", () => {
    expect(
      sumByCurrency([
        { price: 10, currency: "USD" },
        { price: 20, currency: "EUR" },
        { price: 5, currency: "CHF" },
      ])
    ).toEqual([
      { currency: "EUR", total: 20 },
      { currency: "CHF", total: 5 },
      { currency: "USD", total: 10 },
    ]);
  });

  it("treats null currency as EUR, skips null prices and a 0 beside real money", () => {
    expect(
      sumByCurrency([
        { price: 30, currency: null },
        { price: null, currency: "USD" },
        { price: 0, currency: "USD" },
      ])
    ).toEqual([{ currency: "EUR", total: 30 }]);
  });

  // A free award booking is a price of 0, not an unknown one: a trip made
  // only of it used to read "—" as if nobody had written anything down.
  it("answers 0 for a trip whose only price is a recorded 0", () => {
    expect(sumByCurrency([{ price: 0, currency: "EUR" }])).toEqual([{ currency: "EUR", total: 0 }]);
  });

  // 0 is 0 in every currency: a free leg priced in USD needs no rate and must
  // not append "+ 0 $" to a EUR total.
  it("folds zero buckets into one, and drops them beside real money", () => {
    expect(
      sumByCurrency([
        { price: 0, currency: "USD" },
        { price: 0, currency: "EUR" },
      ])
    ).toEqual([{ currency: "EUR", total: 0 }]);
    expect(sumByCurrency([{ price: 0, currency: "USD" }])).toEqual([{ currency: "USD", total: 0 }]);
    expect(
      sumByCurrency([
        { price: 250, currency: "EUR" },
        { price: 0, currency: "USD" },
      ])
    ).toEqual([{ currency: "EUR", total: 250 }]);
  });

  it("returns [] for no priced bookings", () => {
    expect(sumByCurrency([])).toEqual([]);
  });
});
