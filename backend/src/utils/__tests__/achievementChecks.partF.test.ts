// Part F (kurios expansion) requirement-type dispatch + stat computation.
//
// Same invariants as the partD/E test: every `requirementType` referenced by
// `seedsPartF` MUST have a real case in `checkAchievement`'s switch (a missing
// case silently falls through to `default` and the badge can never fire), and
// every code across ALL seed parts must stay unique.

import type { Achievement } from "@prisma/client";
import { checkAchievement } from "../achievementChecks";
import {
  calculateUserStats,
  type FlightData,
  type UserStats,
} from "../achievementStats";
import { calculateCruiseStats, type CruiseData, type CruisePortData } from "../cruiseStats";
import { achievements } from "../../data/achievements";
import { seedsPartA } from "../../data/achievementSeeds/partA";
import { seedsPartB } from "../../data/achievementSeeds/partB";
import { seedsPartC } from "../../data/achievementSeeds/partC";
import { seedsPartD } from "../../data/achievementSeeds/partD";
import { seedsPartE } from "../../data/achievementSeeds/partE";
import { seedsPartF } from "../../data/achievementSeeds/partF";

jest.mock("../../services/airportCache", () => ({
  getCachedAirports: jest.fn(async () => new Map()),
}));

function fakeAchievement(overrides: Partial<Achievement>): Achievement {
  return {
    id: "test-id",
    code: "TEST_CODE",
    name: "Test",
    description: "Test",
    category: "kurios",
    domain: "flight",
    icon: "🎲",
    tier: "bronze",
    requirement: 1,
    requirementType: "flights_count",
    points: 10,
    isHidden: false,
    createdAt: new Date(),
    ...overrides,
  } as Achievement;
}

function makeFlight(overrides: Partial<FlightData>): FlightData {
  return {
    id: "f1",
    depLat: 50.0,
    depLon: 8.5,
    arrLat: 38.7,
    arrLon: -9.1,
    depIcao: "EDDF",
    depIata: "FRA",
    arrIcao: "LPPT",
    arrIata: "LIS",
    airline: "Lufthansa",
    aircraft: "A320",
    flightNumber: "LH1166",
    seatNumber: "12A",
    seatClass: "economy",
    notes: null,
    actualDeparture: null,
    delayMinutes: null,
    departureTime: new Date("2026-05-05T10:00:00Z"),
    arrivalTime: new Date("2026-05-05T13:00:00Z"),
    status: "flown",
    specialType: null,
    ...overrides,
  };
}

describe("checkAchievement — partF requirement types dispatch", () => {
  it("every requirementType used by seedsPartF is handled by a real case", async () => {
    const base = await calculateUserStats([]);
    const maxedStats: UserStats = {
      ...base,
      friday13Flights: 1_000,
      xmasFlights: 1_000,
      palindromeFlights: 1_000,
      maxFlightsOneDay: 1_000,
      hasSameDayReturn: 1,
      flight666Count: 1_000,
      jackpot777Count: 1_000,
      // Not a plain count: 24 zones is the physical maximum.
      maxTimezoneSpan: 24,
      aisleStreak: 1_000,
      airlines: new Set(Array.from({ length: 200 }, (_, i) => `airline-${i}`)),
      aircraftTypes: new Set(Array.from({ length: 200 }, (_, i) => `type-${i}`)),
      hasCruiseEquatorCrossing: true,
      cruiseShipLoyaltyMax: 1_000,
      cruiseInsideCabinCount: 1_000,
      lodgingAllInclusiveNights: 1_000,
      // Raw latitude, negative in the south — the pole is the max.
      lodgingSouthernmostLat: -90,
      hasLodgingBirthdayStay: true,
      hasLodgingXmasStay: true,
    };
    // `antarctic_flight` is flights-based, not stats-based — feed a flight
    // that dips below the Antarctic Circle.
    const antarcticFlights = [makeFlight({ depLat: -77.8, depLon: 166.7 })];

    const failed: string[] = [];
    for (const def of seedsPartF) {
      const { isUnlocked, progress } = checkAchievement(
        fakeAchievement({
          requirementType: def.requirementType,
          requirement: def.requirement,
        }),
        maxedStats,
        antarcticFlights,
      );
      if (!isUnlocked || progress <= 0) {
        failed.push(`${def.code} (${def.requirementType})`);
      }
    }
    expect(failed).toEqual([]);
  });

  it("lodging_southern_lat clamps northern-only travellers to 0", async () => {
    const base = await calculateUserStats([]);
    const stats: UserStats = { ...base, lodgingSouthernmostLat: 48.1 };
    const result = checkAchievement(
      fakeAchievement({ requirementType: "lodging_southern_lat", requirement: 45 }),
      stats,
      [],
    );
    expect(result.progress).toBe(0);
    expect(result.isUnlocked).toBe(false);
  });
});

describe("calculateUserStats — kurios expansion counters", () => {
  it("counts Friday-the-13th, Christmas and palindrome-date flights", async () => {
    const stats = await calculateUserStats([
      makeFlight({
        id: "friday",
        departureTime: new Date("2026-02-13T10:00:00Z"),
        arrivalTime: new Date("2026-02-13T13:00:00Z"),
      }),
      makeFlight({
        id: "xmas",
        departureTime: new Date("2025-12-24T10:00:00Z"),
        arrivalTime: new Date("2025-12-24T13:00:00Z"),
      }),
      makeFlight({
        id: "palindrome",
        departureTime: new Date("2022-02-22T10:00:00Z"),
        arrivalTime: new Date("2022-02-22T13:00:00Z"),
      }),
    ]);
    expect(stats.friday13Flights).toBe(1);
    expect(stats.xmasFlights).toBe(1);
    expect(stats.palindromeFlights).toBe(1);
  });

  it("tracks the hat-trick (max flights on one calendar day)", async () => {
    const day = (h: number) => new Date(`2026-05-05T${String(h).padStart(2, "0")}:00:00Z`);
    const stats = await calculateUserStats([
      makeFlight({ id: "a", departureTime: day(6), arrivalTime: day(8) }),
      makeFlight({ id: "b", departureTime: day(10), arrivalTime: day(12) }),
      makeFlight({ id: "c", departureTime: day(15), arrivalTime: day(17) }),
      makeFlight({
        id: "other-day",
        departureTime: new Date("2026-05-07T10:00:00Z"),
        arrivalTime: new Date("2026-05-07T12:00:00Z"),
      }),
    ]);
    expect(stats.maxFlightsOneDay).toBe(3);
  });

  it("detects a same-day out-and-back on one route", async () => {
    const out = makeFlight({
      id: "out",
      departureTime: new Date("2026-05-05T07:00:00Z"),
      arrivalTime: new Date("2026-05-05T10:00:00Z"),
    });
    const back = makeFlight({
      id: "back",
      depIata: "LIS",
      depIcao: "LPPT",
      arrIata: "FRA",
      arrIcao: "EDDF",
      depLat: 38.7,
      depLon: -9.1,
      arrLat: 50.0,
      arrLon: 8.5,
      departureTime: new Date("2026-05-05T18:00:00Z"),
      arrivalTime: new Date("2026-05-05T21:00:00Z"),
    });
    expect((await calculateUserStats([out, back])).hasSameDayReturn).toBe(1);
    // Same pair on DIFFERENT days must not fire.
    const backNextDay = {
      ...back,
      departureTime: new Date("2026-05-06T18:00:00Z"),
      arrivalTime: new Date("2026-05-06T21:00:00Z"),
    };
    expect((await calculateUserStats([out, backNextDay])).hasSameDayReturn).toBe(0);
  });

  it("counts flight number 666, and 777 only on a Boeing 777", async () => {
    const stats = await calculateUserStats([
      makeFlight({ id: "hell", flightNumber: "LH666" }),
      makeFlight({ id: "jackpot", flightNumber: "EK777", aircraft: "Boeing 777-300ER" }),
      makeFlight({ id: "near-miss", flightNumber: "LH777", aircraft: "A320" }),
    ]);
    expect(stats.flight666Count).toBe(1);
    expect(stats.jackpot777Count).toBe(1);
  });

  it("derives the widest time-zone span from the longitude gap", async () => {
    // FRA (8.5°E) → HND-ish (139.7°E): 131.2° ≈ 8 zones.
    const stats = await calculateUserStats([
      makeFlight({ id: "long", arrLat: 35.5, arrLon: 139.7 }),
    ]);
    expect(stats.maxTimezoneSpan).toBe(8);
  });

  it("tracks the aisle streak alongside window and middle", async () => {
    const seatFlight = (id: string, isoDay: string, seatNumber: string) =>
      makeFlight({
        id,
        seatNumber,
        departureTime: new Date(`${isoDay}T08:00:00Z`),
        arrivalTime: new Date(`${isoDay}T11:00:00Z`),
      });
    const stats = await calculateUserStats([
      seatFlight("a1", "2026-05-01", "12C"),
      seatFlight("a2", "2026-05-02", "3D"),
      seatFlight("a3", "2026-05-03", "40G"),
      // A window seat breaks the aisle run.
      seatFlight("w1", "2026-05-04", "12A"),
      seatFlight("a4", "2026-05-05", "22H"),
    ]);
    expect(stats.aisleStreak).toBe(3);
    expect(stats.windowStreak).toBe(1);
  });
});

describe("calculateCruiseStats — equator, ship loyalty, inside cabin", () => {
  const port = (id: number, lat: number, lon: number): CruisePortData => ({
    id,
    name: `Port ${id}`,
    city: null,
    country: null,
    region: null,
    unlocode: null,
    lat,
    lon,
    timezone: null,
    isUserAdded: false,
  });

  const cruise = (overrides: Partial<CruiseData>): CruiseData => ({
    id: "c1",
    shipId: 1,
    cruiseLine: "Test Line",
    cabinType: "inside",
    deck: 5,
    startDate: new Date("2026-01-10T00:00:00Z"),
    endDate: new Date("2026-01-20T00:00:00Z"),
    stops: [],
    ...overrides,
  });

  it("flags a leg whose endpoints sit in opposite hemispheres", () => {
    const stats = calculateCruiseStats([
      cruise({
        stops: [
          { portId: 1, port: port(1, 1.3, 103.8), dayNumber: 1, isAtSea: false },
          { portId: 2, port: port(2, -6.2, 106.8), dayNumber: 3, isAtSea: false },
        ],
      }),
    ]);
    expect(stats.hasEquatorCrossing).toBe(true);
  });

  it("does not flag same-hemisphere itineraries", () => {
    const stats = calculateCruiseStats([
      cruise({
        stops: [
          { portId: 1, port: port(1, 53.5, 8.6), dayNumber: 1, isAtSea: false },
          { portId: 2, port: port(2, 60.4, 5.3), dayNumber: 3, isAtSea: false },
        ],
      }),
    ]);
    expect(stats.hasEquatorCrossing).toBe(false);
  });

  it("counts ship loyalty and inside cabins", () => {
    const stats = calculateCruiseStats([
      cruise({ id: "c1", shipId: 7 }),
      cruise({ id: "c2", shipId: 7, cabinType: "balcony" }),
      cruise({ id: "c3", shipId: 7 }),
      cruise({ id: "c4", shipId: 9 }),
    ]);
    expect(stats.shipLoyaltyMax).toBe(3);
    expect(stats.insideCabinCount).toBe(3);
  });
});

describe("achievement seed integrity incl. partF", () => {
  it("has no duplicate codes across all six seed parts", () => {
    const allCodes = [
      ...seedsPartA,
      ...seedsPartB,
      ...seedsPartC,
      ...seedsPartD,
      ...seedsPartE,
      ...seedsPartF,
    ].map((a) => a.code);
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const code of allCodes) {
      if (seen.has(code)) duplicates.push(code);
      seen.add(code);
    }
    expect(duplicates).toEqual([]);
  });

  it("the aggregated `achievements` export includes every partF entry", () => {
    const achievementCodes = new Set(achievements.map((a) => a.code));
    for (const def of seedsPartF) {
      expect(achievementCodes.has(def.code)).toBe(true);
    }
  });
});
