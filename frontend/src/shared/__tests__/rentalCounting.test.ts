import {
  isCountableRental,
  odometerDistanceKm,
  rentalCost,
  rentalCountries,
  rentalDays,
  rentalDrivenKm,
  rentalYear,
} from "../rentalCounting";
import { describe, expect, it } from "vitest";

/**
 * The truth table of "does a rental count, and how" — mirrored by
 * backend/src/shared/__tests__/rentalCounting.test.ts. Values invented.
 */
describe("rentalCounting", () => {
  const at = (utc: string, zone = "Europe/Berlin") => ({ time: new Date(utc), zone });
  const rental = (pickup: ReturnType<typeof at>, ret: ReturnType<typeof at>) => ({
    pickupTime: pickup.time,
    pickupTimezone: pickup.zone,
    returnTime: ret.time,
    returnTimezone: ret.zone,
  });

  it.each([
    ["completed", true],
    ["scheduled", false],
    ["in_progress", false],
    ["cancelled", false],
  ])("status %s counts: %s", (status, counts) => {
    expect(isCountableRental({ status })).toBe(counts);
  });

  it("counts calendar days on the stations' calendars, Monday to Wednesday as two", () => {
    expect(rentalDays(rental(at("2026-07-06T08:00:00Z"), at("2026-07-08T08:00:00Z")))).toBe(2);
  });

  it("counts a same-day rental as one day, never zero", () => {
    expect(rentalDays(rental(at("2026-07-06T08:00:00Z"), at("2026-07-06T15:00:00Z")))).toBe(1);
  });

  it("reads each end on its own station's clock", () => {
    // 23:30 UTC on the 6th is the 7th in Berlin; the return in New York is still the 9th.
    const r = rental(at("2026-07-06T23:30:00Z"), at("2026-07-10T02:00:00Z", "America/New_York"));
    expect(rentalDays(r)).toBe(2);
  });

  it("files a rental under its pickup year on the station's calendar", () => {
    expect(
      rentalYear({ pickupTime: new Date("2026-12-31T23:30:00Z"), pickupTimezone: "Europe/Berlin" })
    ).toBe(2027);
  });

  it("names both stations' countries once, and never a malformed one", () => {
    expect(rentalCountries({ pickupCountry: "de", returnCountry: "DE" })).toEqual(["DE"]);
    expect(rentalCountries({ pickupCountry: "DE", returnCountry: "Germany" })).toEqual(["DE"]);
    expect(rentalCountries({ pickupCountry: null, returnCountry: null })).toEqual([]);
  });

  it("costs the invoice amount first, the booked price second, and nothing without either", () => {
    const base = {
      status: "completed",
      price: 200,
      currency: "EUR",
      finalAmount: null,
      finalCurrency: null,
    };
    expect(rentalCost(base)).toEqual({ amount: 200, currency: "EUR", source: "booked" });
    expect(rentalCost({ ...base, finalAmount: 260, finalCurrency: "EUR" })).toEqual({
      amount: 260,
      currency: "EUR",
      source: "final",
    });
    expect(rentalCost({ ...base, price: null })).toBeNull();
  });

  // Owner, 2026-10-01: a cancelled rental cost its fee, flagged as one — and
  // its booked price, never paid, is no cost at all.
  it("costs a cancelled rental its fee only, flagged as a fee", () => {
    const cancelled = {
      status: "cancelled",
      price: 200,
      currency: "EUR",
      finalAmount: null,
      finalCurrency: null,
    };
    expect(rentalCost(cancelled)).toBeNull();
    expect(rentalCost({ ...cancelled, finalAmount: 45.5, finalCurrency: "EUR" })).toEqual({
      amount: 45.5,
      currency: "EUR",
      source: "cancellationFee",
    });
  });
});

/**
 * forgejo#206: the km a rental was driven, as every reader takes them. A
 * stored figure (invoice, or a hand correction) wins; else in − out of both
 * odometer readings; else null. One reading never yields a figure.
 */
describe("rentalDrivenKm", () => {
  const km = (
    distanceKm: number | null,
    distanceSource: string | null,
    odometerOutKm: number | null,
    odometerInKm: number | null
  ) => rentalDrivenKm({ distanceKm, distanceSource, odometerOutKm, odometerInKm });

  it.each([
    // stored, source, out, in → expected
    [null, null, 10_000, 10_634, { km: 634, source: "odometer" }],
    [null, null, 10_000, 10_000, { km: 0, source: "odometer" }],
    [null, null, 10_000, null, null],
    [null, null, null, 10_634, null],
    [null, null, null, null, null],
    [null, null, 10_634, 10_000, null],
    [700, "user", 10_000, 10_634, { km: 700, source: "user" }],
    [700, "user", null, null, { km: 700, source: "user" }],
    [634, "invoice", 10_000, 10_634, { km: 634, source: "invoice" }],
    [634, "invoice", null, null, { km: 634, source: "invoice" }],
    [634, "agreement", null, null, { km: 634, source: "agreement" }],
    [634, null, 10_000, 10_100, { km: 634, source: null }],
  ] as const)("stored %s (%s), odometer %s → %s gives %j", (d, s, o, i, expected) => {
    expect(km(d, s, o, i)).toEqual(expected);
  });

  it("names the odometer difference only when both readings are known", () => {
    expect(odometerDistanceKm(5, 12)).toBe(7);
    expect(odometerDistanceKm(5, null)).toBeNull();
    expect(odometerDistanceKm(null, 12)).toBeNull();
    expect(odometerDistanceKm(12, 5)).toBeNull();
  });
});
