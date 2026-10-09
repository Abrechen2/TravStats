import { prisma } from "../../db";
import { achievements } from "../../data/achievements";
import {
  calculateRailAchievementStats,
  checkRailAchievement,
  RAIL_REQUIREMENT_TYPES,
} from "../railAchievements";

/**
 * The rail badges' measures (2.7): only completed rides count, a cancelled or
 * upcoming one never does, and each kind of ride is counted by the one rule in
 * `shared/railRideKinds.ts`.
 */

const USER = "railbadges";

type Ride = Parameters<typeof prisma.railJourney.create>[0]["data"];

const FRANKFURT = { depStationName: "Frankfurt (Main) Hbf", depLat: 50.107, depLon: 8.663 };

describe("rail achievements", () => {
  let userId: string;

  const add = (over: Partial<Ride>) =>
    prisma.railJourney.create({
      data: {
        userId,
        ...FRANKFURT,
        depCountry: "DE",
        depTimezone: "Europe/Berlin",
        arrStationName: "München Hbf",
        arrLat: 48.14,
        arrLon: 11.558,
        arrCountry: "DE",
        arrTimezone: "Europe/Berlin",
        departureTime: new Date("2025-05-01T08:00:00Z"),
        arrivalTime: new Date("2025-05-01T11:30:00Z"),
        status: "completed",
        ...over,
      } as Ride,
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;

    await add({ operator: "DB Fernverkehr", trainCategory: "ICE", distanceKm: 420 });
    // Frankfurt → Paris: high-speed, across a border, straight-line km.
    await add({
      operator: "db fernverkehr",
      trainCategory: "ICE",
      arrStationName: "Paris Est",
      arrLat: 48.877,
      arrLon: 2.359,
      arrCountry: "FR",
      arrTimezone: "Europe/Paris",
      distanceKm: 480,
      distanceSource: "great_circle",
    });
    // Vienna → Hamburg Nightjet, sleeper, 1 200 km along the traced line.
    await add({
      operator: "ÖBB",
      trainCategory: "NJ",
      travelClass: "sleeper",
      depStationName: "Wien Hbf",
      depLat: 48.185,
      depLon: 16.376,
      depCountry: "AT",
      depTimezone: "Europe/Vienna",
      arrStationName: "Hamburg Hbf",
      arrLat: 53.553,
      arrLon: 10.007,
      departureTime: new Date("2025-12-31T21:58:00Z"),
      arrivalTime: new Date("2026-01-01T08:35:00Z"),
      distanceKm: 1200,
      distanceSource: "route",
    });
    // A ride with no distance: it counts as a ride, never as zero kilometres.
    await add({ operator: "SBB", trainCategory: "IR", distanceKm: null });

    // None of these count for anything.
    await add({ status: "cancelled", trainCategory: "TGV", distanceKm: 9000, operator: "SNCF" });
    await add({
      status: "scheduled",
      trainCategory: "TGV",
      distanceKm: 9000,
      operator: "SNCF",
      departureTime: new Date("2099-01-01T08:00:00Z"),
      arrivalTime: new Date("2099-01-01T12:00:00Z"),
      arrCountry: "IT",
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
  });

  it("counts completed rides only, and each kind of ride by its rule", async () => {
    const stats = await calculateRailAchievementStats(userId);
    expect(stats).toEqual({
      railRidesCount: 4,
      railKm: 2100,
      railCountries: 3, // DE, FR, AT — never the cancelled or upcoming rides'
      railNightTrains: 1,
      railOperators: 3, // DB Fernverkehr (two spellings), ÖBB, SBB
      railLongestKm: 1200,
      railHighSpeedRides: 2,
      railCrossBorderRides: 2,
      // forgejo#261: no station seen twice, no booking linking two rides,
      // and three of the four counted rides open a connection in one year.
      railStationReturnYears: 0,
      railDocumentedTransferJourneys: 0,
      railNewConnectionsYearMax: 3,
    });
  });

  it("answers every rail badge, and nothing else", async () => {
    const stats = await calculateRailAchievementStats(userId);
    const first = checkRailAchievement({ requirementType: "rail_count", requirement: 1 }, stats);
    expect(first).toEqual({ isUnlocked: true, progress: 4 });
    const km = checkRailAchievement({ requirementType: "rail_km", requirement: 10000 }, stats);
    expect(km).toEqual({ isUnlocked: false, progress: 2100 });
    expect(checkRailAchievement({ requirementType: "flights_count", requirement: 1 }, stats)).toBe(
      null
    );
  });

  it("gives every rail seed a measure and the rail domain", () => {
    const rail = achievements.filter((a) => a.requirementType.startsWith("rail_"));
    expect(rail.length).toBeGreaterThanOrEqual(10);
    for (const a of rail) {
      expect(a.domain).toBe("rail");
      // A typo in a requirementType would leave the badge at 0 forever.
      expect(RAIL_REQUIREMENT_TYPES).toContain(a.requirementType);
    }
  });
});
