import { prisma } from "../../db";
import { achievements } from "../../data/achievements";
import {
  calculateRentalAchievementStats,
  checkRentalAchievement,
  RENTAL_REQUIREMENT_TYPES,
} from "../rentalAchievements";

/**
 * forgejo#262 — the rental badges count completed rentals only, a one-way
 * rental by the rule the statistics use, and the odometer badge only where
 * both readings are known.
 */
const USER = "rentalbadges";
type Rental = Parameters<typeof prisma.rentalBooking.create>[0]["data"];

describe("rental achievements", () => {
  let userId: string;

  const add = (over: Partial<Rental>) =>
    prisma.rentalBooking.create({
      data: {
        userId,
        provider: "Sixt",
        pickupStationName: "Frankfurt Airport",
        pickupLat: 50.0379,
        pickupLon: 8.5622,
        pickupTimezone: "Europe/Berlin",
        returnStationName: "Frankfurt Airport",
        returnLat: 50.0379,
        returnLon: 8.5622,
        returnTimezone: "Europe/Berlin",
        pickupTime: new Date("2025-05-01T08:00:00Z"),
        returnTime: new Date("2025-05-04T08:00:00Z"),
        status: "completed",
        ...over,
      } as Rental,
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    await add({ odometerOutKm: 1000, odometerInKm: 1400 });
    // One-way: returned in Munich.
    await add({
      returnStationName: "München Hbf",
      returnLat: 48.1402,
      returnLon: 11.5586,
      odometerOutKm: 5,
    });
    // Neither a cancelled nor an upcoming rental counts, whatever it carries.
    await add({
      status: "cancelled",
      returnStationName: "Berlin",
      returnLat: 52.52,
      returnLon: 13.4,
      odometerOutKm: 1,
      odometerInKm: 2,
    });
    await add({ status: "scheduled", odometerOutKm: 1, odometerInKm: 2 });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
  });

  it("measures completed rentals only", async () => {
    expect(await calculateRentalAchievementStats(userId)).toEqual({
      rentalCount: 2,
      rentalOneWayCount: 1,
      // Half a pair is no reading: the one-way rental has only its out-km.
      rentalOdometerDocumented: 1,
    });
  });

  it("answers every rental badge, and nothing else", async () => {
    const stats = await calculateRentalAchievementStats(userId);
    expect(
      checkRentalAchievement({ requirementType: "rental_count", requirement: 1 }, stats)
    ).toEqual({ isUnlocked: true, progress: 2 });
    expect(
      checkRentalAchievement(
        { requirementType: "rental_odometer_documented", requirement: 5 },
        stats
      )
    ).toEqual({ isUnlocked: false, progress: 1 });
    expect(
      checkRentalAchievement({ requirementType: "rail_count", requirement: 1 }, stats)
    ).toBeNull();
    const seeds = achievements.filter((a) => a.domain === "rental");
    expect(seeds.map((a) => a.code).sort()).toEqual([
      "RENTAL_FIRST",
      "RENTAL_ODOMETER_5",
      "RENTAL_ONE_WAY",
    ]);
    for (const a of seeds) expect(RENTAL_REQUIREMENT_TYPES).toContain(a.requirementType);
  });
});
