import { calculateBusinessStats } from "../businessStats";

/**
 * forgejo#256 — abstention is a result. A rate over no priced flight and an
 * average over no duration are unknown, and the server says so with null;
 * a 0 would read as "free" and "no time in the air".
 */
type Flight = Parameters<typeof calculateBusinessStats>[0][number];

const unpriced = {
  id: "f1",
  status: "flown",
  departureTime: new Date("2026-06-01T10:00:00Z"),
  arrivalTime: new Date("2026-06-01T11:00:00Z"),
  depLat: 0,
  depLon: 0,
  arrLat: 0,
  arrLon: 1,
  createdAt: new Date(),
} as Flight;

describe("calculateBusinessStats — abstention", () => {
  it("answers null for both rates when no flight carries a price", () => {
    const stats = calculateBusinessStats([unpriced], "EUR");
    expect(stats.costPerKm).toBeNull();
    expect(stats.costPerHour).toBeNull();
    expect(stats.totalCost).toBeNull();
  });

  it("answers null for the average duration when no flight counts", () => {
    expect(calculateBusinessStats([], "EUR").avgFlightDuration).toBeNull();
  });

  it("keeps a real rate when a price exists", () => {
    const stats = calculateBusinessStats([{ ...unpriced, price: 100, currency: "EUR" }], "EUR");
    expect(stats.costPerHour).toBe(100);
    expect(stats.costPerKm).toBeGreaterThan(0);
  });
});
