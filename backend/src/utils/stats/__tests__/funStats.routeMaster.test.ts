/**
 * Forgejo #254 — Route Master counts a CONNECTION, i.e. the unordered airport
 * pair, exactly as `/stats/routes` and the Wrapped top route do. An outbound
 * flight and its return used to be two routes of one flight each.
 */
import { calculateFunStats } from "../funStats";
import type { FlightData } from "../types";

jest.mock("../../../services/airportCache", () => ({
  getCachedAirports: jest.fn(async () => new Map()),
}));

function flight(depIata: string | null, arrIata: string | null, day: number): FlightData {
  return {
    id: `${depIata}-${arrIata}-${day}`,
    status: "flown",
    depIata,
    arrIata,
    depIcao: null,
    arrIcao: null,
    depLat: 0,
    depLon: 0,
    arrLat: 0,
    arrLon: 0,
    departureTime: new Date(Date.UTC(2026, 0, day, 10)),
    arrivalTime: new Date(Date.UTC(2026, 0, day, 12)),
    createdAt: new Date(),
  };
}

describe("calculateFunStats — route master", () => {
  it("counts an out-and-back as ONE connection flown twice", async () => {
    const stats = await calculateFunStats([flight("HNL", "OGG", 1), flight("OGG", "HNL", 2)]);
    expect(stats.routeMasterCount).toBe(2);
    expect(stats.routeMaster).toBe("HNL-OGG");
  });

  it("names the pair in sorted order whichever direction was flown most", async () => {
    const stats = await calculateFunStats([
      flight("OGG", "HNL", 1),
      flight("OGG", "HNL", 2),
      flight("FRA", "JFK", 3),
    ]);
    expect(stats.routeMaster).toBe("HNL-OGG");
    expect(stats.routeMasterCount).toBe(2);
  });

  it("abstains for a flight whose airports are unknown", async () => {
    const stats = await calculateFunStats([flight(null, "HNL", 1), flight(null, null, 2)]);
    expect(stats.routeMaster).toBeNull();
    expect(stats.routeMasterCount).toBe(0);
  });
});

describe("calculateFunStats — busiest day (forgejo#256)", () => {
  it("names the LATEST of equally busy days, as the records do", async () => {
    const stats = await calculateFunStats([
      flight("FRA", "LHR", 3),
      flight("LHR", "FRA", 3),
      flight("FRA", "CDG", 9),
      flight("CDG", "FRA", 9),
    ]);
    expect(stats.fastestDay).toBe("2026-01-09");
    expect(stats.fastestDayFlights).toBe(2);
  });
});
