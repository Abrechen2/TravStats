import { computeRentalStats } from "../rentalStats";

/**
 * forgejo#237: a rental with a booked price AND an invoice's final amount
 * costs ONE of them — the invoice's — never both. The booked price stays on
 * the row for the comparison; the statistics read `rentalCost` only.
 */
const row = (over: Record<string, unknown> = {}) => ({
  status: "completed",
  pickupTime: new Date("2026-07-06T08:00:00Z"),
  pickupTimezone: "Europe/Berlin",
  returnTime: new Date("2026-07-08T08:00:00Z"),
  returnTimezone: "Europe/Berlin",
  pickupCountry: "DE",
  returnCountry: "DE",
  pickupAirportId: 1,
  returnAirportId: 1,
  pickupLat: 50,
  pickupLon: 8,
  returnLat: 50,
  returnLon: 8,
  provider: "Testcar",
  broker: null,
  price: 100,
  currency: "EUR",
  finalAmount: null as number | null,
  finalCurrency: null as string | null,
  distanceKm: null,
  distanceSource: null,
  odometerOutKm: null,
  odometerInKm: null,
  ...over,
});

describe("rental cost is counted once", () => {
  it("costs the invoice's amount, not the booked price plus it", () => {
    const stats = computeRentalStats([row({ finalAmount: 130, finalCurrency: "EUR" })], null);
    // Two days: 130 / 2 — a double count would say 115.
    expect(stats.costPerDay).toEqual([{ currency: "EUR", perDay: 65, rentals: 1, days: 2 }]);
  });

  it("costs the booked price while no invoice is known", () => {
    expect(computeRentalStats([row()], null).costPerDay).toEqual([
      { currency: "EUR", perDay: 50, rentals: 1, days: 2 },
    ]);
  });

  it("puts an invoice in another currency under that currency alone, unconverted", () => {
    const stats = computeRentalStats([row({ finalAmount: 140, finalCurrency: "USD" })], null);
    expect(stats.costPerDay).toEqual([{ currency: "USD", perDay: 70, rentals: 1, days: 2 }]);
  });
});
