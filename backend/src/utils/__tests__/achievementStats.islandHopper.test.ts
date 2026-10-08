/**
 * Island Hopper counts FLIGHTS that touch an island airport (forgejo#252).
 *
 * The description says "10 flights with at least one island airport as origin or
 * destination". The counter used to add one per island ENDPOINT, so a single
 * HNL -> OGG flight scored 2 and five of them unlocked the ten-flight tier.
 */

import { calculateUserStats, type FlightData } from "../achievementStats";
import { checkAchievement } from "../achievementChecks";
import { seedsPartB } from "../../data/achievementSeeds/partB";
import type { Achievement } from "../../prisma";

jest.mock("../../services/airportCache", () => ({
  getCachedAirports: jest.fn(async () => new Map()),
}));

function flightBetween(depIata: string, arrIata: string, n = 0): FlightData {
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

describe("Island Hopper — a flight counts at most once (forgejo#252)", () => {
  it("counts 0 for a flight with no island endpoint", async () => {
    const stats = await calculateUserStats([flightBetween("FRA", "JFK")]);
    expect(stats.islandFlights).toBe(0);
  });

  it("counts 1 for a flight with exactly one island endpoint", async () => {
    const stats = await calculateUserStats([flightBetween("FRA", "PMI")]);
    expect(stats.islandFlights).toBe(1);
  });

  it("counts 1, not 2, for an island-to-island flight", async () => {
    const stats = await calculateUserStats([flightBetween("HNL", "OGG")]);
    expect(stats.islandFlights).toBe(1);
  });

  it("does not unlock the ten-flight tier with five island-to-island flights", async () => {
    const flights = Array.from({ length: 5 }, (_, n) => flightBetween("HNL", "OGG", n));
    const stats = await calculateUserStats(flights);
    const seed = seedsPartB.find((a) => a.code === "ISLAND_HOPPER");
    expect(seed).toBeDefined();
    const result = checkAchievement(seed as unknown as Achievement, stats, flights);
    expect(result.progress).toBe(5);
    expect(result.isUnlocked).toBe(false);
  });

  it("unlocks it with ten flights that each touch an island", async () => {
    const flights = Array.from({ length: 10 }, (_, n) => flightBetween("FRA", "PMI", n));
    const stats = await calculateUserStats(flights);
    const seed = seedsPartB.find((a) => a.code === "ISLAND_HOPPER");
    const result = checkAchievement(seed as unknown as Achievement, stats, flights);
    expect(result.isUnlocked).toBe(true);
  });
});
