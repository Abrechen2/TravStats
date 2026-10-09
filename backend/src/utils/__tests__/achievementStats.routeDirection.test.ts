/**
 * Forgejo #254 — the "Fly the same route N times" badges read the same
 * connection rule as Route Master and `/stats/routes`: the unordered pair.
 */
import { calculateUserStats, type FlightData } from "../achievementStats";

jest.mock("../../services/airportCache", () => ({
  getCachedAirports: jest.fn(async () => new Map()),
}));

function flightBetween(depIata: string, arrIata: string, n: number): FlightData {
  return {
    id: `${depIata}-${arrIata}-${n}`,
    depLat: 0,
    depLon: 0,
    arrLat: 0,
    arrLon: 0,
    depIcao: null,
    depIata,
    arrIcao: null,
    arrIata,
    airline: null,
    aircraft: null,
    flightNumber: null,
    seatNumber: null,
    seatClass: null,
    notes: null,
    actualDeparture: null,
    delayMinutes: null,
    departureTime: null,
    arrivalTime: null,
    status: "flown",
    specialType: null,
  };
}

describe("calculateUserStats — route counts", () => {
  it("counts out and back as the same route", async () => {
    const stats = await calculateUserStats([
      flightBetween("HNL", "OGG", 1),
      flightBetween("OGG", "HNL", 2),
      flightBetween("HNL", "OGG", 3),
    ]);
    expect(Math.max(...stats.routeCounts.values())).toBe(3);
    expect(stats.routeCounts.get("HNL-OGG")).toBe(3);
  });
});
