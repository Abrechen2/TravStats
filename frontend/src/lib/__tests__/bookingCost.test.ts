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

  // A hotel-only trip totalled to "—" for the same reason a cruise-only one
  // did: a stay prices itself as `totalPrice`, which the cost model never read.
  it("counts a lodging stay that carries its own price", () => {
    const sources = tripCostSources([], [], [], [{ totalPrice: 420, currency: "EUR", bookingId: null }]);
    expect(sumByCurrency(sources)).toEqual([{ currency: "EUR", total: 420 }]);
  });

  it("skips a stay whose price already sits on its booking", () => {
    const sources = tripCostSources(
      [{ price: 420, currency: "EUR" }],
      [],
      [],
      [{ totalPrice: 420, currency: "EUR", bookingId: "b1" }]
    );
    expect(sumByCurrency(sources)).toEqual([{ currency: "EUR", total: 420 }]);
  });

  it("keeps a stay in a foreign currency separate", () => {
    const sources = tripCostSources(
      [{ price: 300, currency: "EUR" }],
      [],
      [],
      [{ totalPrice: 250, currency: "CHF", bookingId: null }]
    );
    expect(sumByCurrency(sources)).toEqual([
      { currency: "EUR", total: 300 },
      { currency: "CHF", total: 250 },
    ]);
  });

  // The FX snapshot on a stay is a second opinion about the same money, never
  // an addition — only the raw amount may reach the total.
  it("ignores a stay with no price at all", () => {
    const sources = tripCostSources([], [], [], [{ totalPrice: null, currency: "EUR", bookingId: null }]);
    expect(sumByCurrency(sources)).toEqual([]);
  });

  // A stay priced only per night used to contribute NOTHING to the total —
  // visibly priced on its own page, invisible in the trip sum.
  it("falls back to per-night × nights when no total was typed", () => {
    const sources = tripCostSources(
      [],
      [],
      [],
      [
        {
          totalPrice: null,
          pricePerNight: 140,
          checkIn: "2026-05-01T00:00:00.000Z",
          checkOut: "2026-05-04T00:00:00.000Z",
          currency: "EUR",
          bookingId: null,
        },
      ]
    );
    expect(sumByCurrency(sources)).toEqual([{ currency: "EUR", total: 420 }]);
  });

  it("prefers the typed total over the per-night derivation", () => {
    const sources = tripCostSources(
      [],
      [],
      [],
      [
        {
          // Deliberately different from 3 × 140: the typed figure wins, e.g. a
          // package rate that is not nights × rack rate.
          totalPrice: 399,
          pricePerNight: 140,
          checkIn: "2026-05-01T00:00:00.000Z",
          checkOut: "2026-05-04T00:00:00.000Z",
          currency: "EUR",
          bookingId: null,
        },
      ]
    );
    expect(sumByCurrency(sources)).toEqual([{ currency: "EUR", total: 399 }]);
  });

  it("contributes nothing for a per-night price without dates", () => {
    const sources = tripCostSources(
      [],
      [],
      [],
      [{ totalPrice: null, pricePerNight: 140, currency: "EUR", bookingId: null }]
    );
    expect(sumByCurrency(sources)).toEqual([]);
  });

  it("adds flights, cruises and stays together in one currency", () => {
    const sources = tripCostSources(
      [{ price: 100, currency: "EUR" }],
      [{ price: 200, currency: "EUR", bookingId: null }],
      [{ price: 300, currency: "EUR", bookingId: null }],
      [{ totalPrice: 400, currency: "EUR", bookingId: null }]
    );
    expect(sumByCurrency(sources)).toEqual([{ currency: "EUR", total: 1000 }]);
  });
});
