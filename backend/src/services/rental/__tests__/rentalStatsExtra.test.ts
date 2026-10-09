import { describe, it, expect } from "@jest/globals";

import { computeRentalExtraStats, inRentalPeriod, type RentalExtraRow } from "../rentalStatsExtra";

/**
 * forgejo#262 — rental efficiency, booked vs billed, vehicles and records.
 * Every ratio is taken over ONE subset; nothing is converted, and nothing is
 * called an upgrade.
 */
let seq = 0;
function rental(over: Partial<RentalExtraRow> = {}): RentalExtraRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    status: "completed",
    provider: "Sixt",
    broker: null,
    pickupTime: new Date("2025-07-06T08:00:00Z"),
    pickupTimezone: "Europe/Berlin",
    returnTime: new Date("2025-07-08T08:00:00Z"),
    returnTimezone: "Europe/Berlin",
    price: null,
    currency: null,
    finalAmount: null,
    finalCurrency: null,
    finalAmountSource: null,
    distanceKm: null,
    distanceSource: null,
    odometerOutKm: null,
    odometerInKm: null,
    vehicleClass: null,
    acrissCode: null,
    vehicleExample: null,
    vehicleDriven: null,
    ...over,
  };
}

describe("rental efficiency", () => {
  it("divides km by the days of the SAME rentals, and cost by the km of the same rentals", () => {
    const stats = computeRentalExtraStats([
      // 2 days, 300 km, 120 EUR.
      rental({ odometerOutKm: 1000, odometerInKm: 1300, price: 120, currency: "EUR" }),
      // 2 days, km unknown — out of both ratios, though it carries a price.
      rental({ price: 500, currency: "EUR" }),
      // 2 days, 100 km from the invoice, no price — in km/day, out of cost/km.
      rental({ distanceKm: 100, distanceSource: "invoice" }),
    ]);
    expect(stats.kmPerDay).toEqual({ value: 100, rentals: 2, km: 400, days: 4 });
    expect(stats.costPerKm).toEqual([{ currency: "EUR", perKm: 0.4, rentals: 1, km: 300 }]);
  });

  it("abstains when no rental has known km — never 0 km per day", () => {
    const stats = computeRentalExtraStats([rental({ price: 80, currency: "EUR" })]);
    expect(stats.kmPerDay.value).toBeNull();
    expect(stats.costPerKm).toEqual([]);
  });

  it("keeps currencies apart in cost per km", () => {
    const stats = computeRentalExtraStats([
      rental({ distanceKm: 100, price: 50, currency: "EUR" }),
      rental({ distanceKm: 200, price: 50, currency: "USD" }),
    ]);
    expect(stats.costPerKm.map((c) => [c.currency, c.perKm])).toEqual([
      ["EUR", 0.5],
      ["USD", 0.25],
    ]);
  });
});

describe("booked against billed", () => {
  it("compares only a secured final amount in the booked currency", () => {
    const stats = computeRentalExtraStats([
      rental({
        price: 100,
        currency: "EUR",
        finalAmount: 135.5,
        finalCurrency: "EUR",
        finalAmountSource: "invoice",
      }),
      // A final amount of unrecorded origin is not secured.
      rental({ price: 100, currency: "EUR", finalAmount: 90, finalCurrency: "EUR" }),
      // Billed in another currency: counted as such, never converted.
      rental({
        price: 100,
        currency: "EUR",
        finalAmount: 120,
        finalCurrency: "USD",
        finalAmountSource: "invoice",
      }),
    ]);
    expect(stats.bookedVsFinal).toEqual({
      byCurrency: [{ currency: "EUR", rentals: 1, booked: 100, final: 135.5, difference: 35.5 }],
      otherCurrency: 1,
    });
  });
});

describe("rental vehicles", () => {
  it("compares the promised and the driven car neutrally and counts distinct models", () => {
    const stats = computeRentalExtraStats([
      rental({
        vehicleClass: "Compact",
        vehicleExample: "VW Golf or similar",
        vehicleDriven: "vw golf",
      }),
      rental({ acrissCode: "cdmr", vehicleExample: "VW Golf", vehicleDriven: "Seat Leon" }),
      rental({ vehicleClass: "compact", vehicleDriven: "Seat  Leon" }),
    ]);
    expect(stats.vehicles).toEqual({
      distinctDriven: 2,
      withDriven: 3,
      classes: [
        { label: "Compact", rentals: 2 },
        { label: "CDMR", rentals: 1 },
      ],
      promisedVsDriven: { compared: 2, sameModel: 1, otherModel: 1 },
    });
  });
});

describe("rental records", () => {
  it("names the longest rental, the farthest known distance and the providers first used in the period", () => {
    const old = rental({ provider: "Sixt", pickupTime: new Date("2023-05-01T08:00:00Z") });
    const long = rental({
      provider: "Europcar",
      returnTime: new Date("2025-07-20T08:00:00Z"),
      odometerOutKm: 10,
      odometerInKm: 20,
    });
    const far = rental({ provider: "sixt ", distanceKm: 900, distanceSource: "invoice" });
    const stats = computeRentalExtraStats([long, far], [old, long, far]);
    expect(stats.records.longest).toEqual({ id: long.id, days: 14, provider: "Europcar" });
    expect(stats.records.farthest).toEqual({ id: far.id, km: 900, source: "invoice" });
    // Sixt was first rented in 2023 — not new in this period, however it is spelled.
    expect(stats.records.newProviders).toEqual(["Europcar"]);
    expect(stats.odometerDocumented).toBe(1);
  });

  // Review M2: a stored 0 km is no farthest-distance record.
  it("names no farthest distance from a rental that drove 0 km", () => {
    const stats = computeRentalExtraStats([rental({ distanceKm: 0, distanceSource: "invoice" })]);
    expect(stats.records.farthest).toBeNull();
  });

  it("counts brokered and direct rentals apart", () => {
    const stats = computeRentalExtraStats([rental({ broker: "Check24" }), rental()]);
    expect(stats.brokered).toEqual({ viaBroker: 1, direct: 1 });
  });
});

describe("the rental period", () => {
  it("cuts a year at a month-day on the pickup station's calendar", () => {
    const late = rental({ pickupTime: new Date("2025-09-26T23:30:00Z") }); // 27th in Berlin
    expect(inRentalPeriod(late, 2025, "09-26")).toBe(false);
    expect(inRentalPeriod(late, 2025, "09-27")).toBe(true);
    expect(inRentalPeriod(late, 2024, null)).toBe(false);
    expect(inRentalPeriod(late, null, null)).toBe(true);
  });
});
