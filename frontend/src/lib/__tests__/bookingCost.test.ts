import { describe, it, expect } from "vitest";
import { sumByCurrency } from "../bookingCost";

describe("sumByCurrency", () => {
  it("sums a single currency", () => {
    expect(sumByCurrency([{ price: 100, currency: "EUR" }, { price: 50, currency: "EUR" }]))
      .toEqual([{ currency: "EUR", total: 150 }]);
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

  it("treats null currency as EUR and skips null/zero prices", () => {
    expect(
      sumByCurrency([
        { price: 30, currency: null },
        { price: null, currency: "USD" },
        { price: 0, currency: "USD" },
      ])
    ).toEqual([{ currency: "EUR", total: 30 }]);
  });

  it("returns [] for no priced bookings", () => {
    expect(sumByCurrency([])).toEqual([]);
  });
});
