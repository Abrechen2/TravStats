import { calculateBusinessStats } from "../businessStats";

/**
 * A price nobody could convert is not a free flight.
 *
 * `baseCost` correctly answers null for a foreign-currency booking with no
 * usable rate snapshot — that part was right. But the loop marked the booking
 * as "seen" anyway and then added its kilometres and hours to the denominator,
 * because the test for "did this contribute?" read the RAW price, which is
 * positive whether or not it converts. So an unconvertible booking behaved
 * like extra travel that cost nothing: a lone 100 EUR flight reported 100 EUR
 * per hour and 0.90 EUR/km, and adding a 500 USD booking with no snapshot
 * moved those to 9.09 and 0.08 while the counted total stayed 100 EUR
 * (audit finding AUD-023).
 */
type Flight = Parameters<typeof calculateBusinessStats>[0][number];

const HOUR = 60 * 60 * 1000;

function flight(over: Partial<Flight>): Flight {
  return {
    id: over.id ?? "f1",
    status: "flown",
    departureTime: new Date("2026-06-01T10:00:00Z"),
    arrivalTime: new Date("2026-06-01T11:00:00Z"),
    // Roughly 111 km along the equator.
    depLat: 0,
    depLon: 0,
    arrLat: 0,
    arrLon: 1,
    price: null,
    taxes: null,
    fees: null,
    currency: null,
    priceBase: null,
    fxBaseCurrency: null,
    bookingId: null,
    booking: null,
    ...over,
  } as Flight;
}

describe("cost rates and unconvertible bookings", () => {
  const priced = flight({
    id: "priced",
    price: 100,
    currency: "EUR",
  });

  it("reports the rate of the one flight that has a usable price", () => {
    // The baseline the finding measured against. Without it the assertion
    // below could pass on a function that reports nothing at all.
    const stats = calculateBusinessStats([priced], "EUR");

    expect(stats.costPerHour).toBeCloseTo(100, 1);
    expect(stats.costPerKm).toBeGreaterThan(0.85);
    expect(stats.costPerKm).toBeLessThan(0.95);
  });

  it("does not let a booking it could not convert change that rate", () => {
    const unconvertible = flight({
      id: "unconvertible",
      departureTime: new Date("2026-06-02T10:00:00Z"),
      arrivalTime: new Date("2026-06-02T19:00:00Z"),
      arrLon: 90,
      bookingId: "b-usd",
      // 500 USD with no snapshot in the base currency — `baseCost` answers
      // null, and nothing of it may reach either side of the ratio.
      booking: { price: 500, currency: "USD", priceBase: null, fxBaseCurrency: null },
    });

    const stats = calculateBusinessStats([priced, unconvertible], "EUR");

    expect(stats.costPerHour).toBeCloseTo(100, 1);
    expect(stats.costPerKm).toBeGreaterThan(0.85);
    expect(stats.costPerKm).toBeLessThan(0.95);
  });

  it("still counts a booking it CAN convert, and its other legs' hours once", () => {
    const legA = flight({
      id: "legA",
      bookingId: "b-eur",
      booking: { price: 200, currency: "EUR", priceBase: 200, fxBaseCurrency: "EUR" },
    });
    const legB = flight({
      id: "legB",
      departureTime: new Date("2026-06-01T12:00:00Z"),
      arrivalTime: new Date("2026-06-01T13:00:00Z"),
      bookingId: "b-eur",
      booking: { price: 200, currency: "EUR", priceBase: 200, fxBaseCurrency: "EUR" },
    });

    const stats = calculateBusinessStats([legA, legB], "EUR");

    // 200 EUR over two hours — the price counted once, both legs' hours in.
    expect(stats.costPerHour).toBeCloseTo(100, 1);
  });
});
