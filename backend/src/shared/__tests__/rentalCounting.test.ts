import {
  isCountableRental,
  rentalCost,
  rentalCountries,
  rentalDays,
  rentalYear,
} from "../rentalCounting";

/**
 * The truth table of "does a rental count, and how" — mirrored by
 * frontend/src/shared/__tests__/rentalCounting.test.ts. Values invented.
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
    const base = { price: 200, currency: "EUR", finalAmount: null, finalCurrency: null };
    expect(rentalCost(base)).toEqual({ amount: 200, currency: "EUR", source: "booked" });
    expect(rentalCost({ ...base, finalAmount: 260, finalCurrency: "EUR" })).toEqual({
      amount: 260,
      currency: "EUR",
      source: "final",
    });
    expect(rentalCost({ ...base, price: null })).toBeNull();
  });
});
