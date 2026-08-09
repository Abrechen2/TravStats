import { describe, it, expect } from "vitest";
import { sumByCurrency, tripCostSources } from "../bookingCost";

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

describe("tripCostSources", () => {
  it("takes bookings plus the flights that have none", () => {
    const sources = tripCostSources(
      [{ price: 300, currency: "EUR" }],
      [
        { price: 250, currency: "EUR", bookingId: null },
        { price: 999, currency: "EUR", bookingId: "b1" },
      ]
    );
    expect(sumByCurrency(sources)).toEqual([{ currency: "EUR", total: 550 }]);
  });

  // A cruise-only trip totalled to "—" although its cruises carried prices:
  // the cost model knew about bookings and flights, never about cruises.
  it("counts a cruise that carries its own price", () => {
    const sources = tripCostSources(
      [],
      [],
      [{ price: 1290, currency: "EUR", bookingId: null }]
    );
    expect(sumByCurrency(sources)).toEqual([{ currency: "EUR", total: 1290 }]);
  });

  it("skips a cruise whose price already sits on its booking", () => {
    const sources = tripCostSources(
      [{ price: 1290, currency: "EUR" }],
      [],
      [{ price: 1290, currency: "EUR", bookingId: "b1" }]
    );
    expect(sumByCurrency(sources)).toEqual([{ currency: "EUR", total: 1290 }]);
  });

  it("keeps a cruise in a foreign currency separate", () => {
    const sources = tripCostSources(
      [{ price: 300, currency: "EUR" }],
      [],
      [{ price: 480, currency: "USD", bookingId: null }]
    );
    expect(sumByCurrency(sources)).toEqual([
      { currency: "EUR", total: 300 },
      { currency: "USD", total: 480 },
    ]);
  });
});
