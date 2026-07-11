// End-to-end proof that lodging achievements actually fire through the
// REAL production engine (`checkAndUpdateAchievements`), not just against
// the pure `calculateLodgingStats` helper. This is the test that closes
// the Task 10 wiring gap: `computeFlyAndStayFlags` / `unionCountries` /
// `calculateLodgingStats` were pure and unit-tested, but nothing in
// `achievements.ts` ever queried `Lodging` / `LodgingStay` rows — every
// lodging achievement would have evaluated against zeros for a real user.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { prisma } from "../../db";
import { checkAndUpdateAchievements } from "../achievements";
import { hashPassword } from "../password";
import { ensureAchievements } from "../../data/achievements";

describe("checkAndUpdateAchievements — lodging integration", () => {
  let userId: string;

  beforeAll(async () => {
    await ensureAchievements();
    await prisma.user.deleteMany({ where: { username: "lodgingachv" } });
    const u = await prisma.user.create({
      data: { username: "lodgingachv", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
  });

  beforeEach(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.userAchievement.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.userAchievement.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("unlocks FIRST_CHECKIN after one real completed stay in the DB", async () => {
    const lodging = await prisma.lodging.create({
      data: {
        userId,
        name: "Grand Hotel Zürich",
        type: "hotel",
        city: "Zürich",
        country: "Switzerland",
      },
    });
    await prisma.lodgingStay.create({
      data: {
        lodgingId: lodging.id,
        userId,
        checkIn: new Date("2024-05-13T00:00:00.000Z"),
        checkOut: new Date("2024-05-16T00:00:00.000Z"), // 3 nights
        status: "completed",
      },
    });

    const unlocked = await checkAndUpdateAchievements(userId);
    const codes = unlocked.map((u) => u.achievement.code);
    expect(codes).toContain("FIRST_CHECKIN");
  });

  it("unlocks LODGING_NIGHTS_10 after a real 10-night stay in the DB", async () => {
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Long Stay Suites", type: "hotel", country: "Germany" },
    });
    await prisma.lodgingStay.create({
      data: {
        lodgingId: lodging.id,
        userId,
        checkIn: new Date("2024-06-01T00:00:00.000Z"),
        checkOut: new Date("2024-06-11T00:00:00.000Z"), // 10 nights
        status: "completed",
      },
    });

    const unlocked = await checkAndUpdateAchievements(userId);
    expect(unlocked.map((u) => u.achievement.code)).toContain("LODGING_NIGHTS_10");
  });

  it("unlocks HOTEL_COLLECTOR_5 after 5 distinct real lodgings, each with a stay", async () => {
    for (let i = 0; i < 5; i++) {
      const lodging = await prisma.lodging.create({
        data: { userId, name: `Hotel ${i}`, type: "hotel", country: "Austria" },
      });
      await prisma.lodgingStay.create({
        data: {
          lodgingId: lodging.id,
          userId,
          checkIn: new Date(`2024-0${(i % 9) + 1}-01T00:00:00.000Z`),
          checkOut: new Date(`2024-0${(i % 9) + 1}-02T00:00:00.000Z`),
          status: "completed",
        },
      });
    }

    const unlocked = await checkAndUpdateAchievements(userId);
    expect(unlocked.map((u) => u.achievement.code)).toContain("HOTEL_COLLECTOR_5");
  });

  it("unlocks FLY_AND_STAY when a real trip links a flight AND a lodging stay", async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: "Fly & Stay Trip" },
    });
    await prisma.flight.create({
      data: {
        userId,
        tripId: trip.id,
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 41.2974,
        arrLon: 2.0833,
        status: "flown",
        departureTime: new Date("2024-07-01T10:00:00.000Z"),
        arrivalTime: new Date("2024-07-01T12:00:00.000Z"),
      },
    });
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Trip-Linked Hotel", type: "hotel", country: "Spain" },
    });
    await prisma.lodgingStay.create({
      data: {
        lodgingId: lodging.id,
        userId,
        tripId: trip.id,
        checkIn: new Date("2024-07-01T00:00:00.000Z"),
        checkOut: new Date("2024-07-03T00:00:00.000Z"),
        status: "completed",
      },
    });

    const unlocked = await checkAndUpdateAchievements(userId);
    expect(unlocked.map((u) => u.achievement.code)).toContain("FLY_AND_STAY");

    await prisma.trip.delete({ where: { id: trip.id } });
  });

  it("does NOT unlock FLY_AND_STAY when the flight and the stay are in separate trips", async () => {
    const tripA = await prisma.trip.create({ data: { userId, name: "Flight-only trip" } });
    const tripB = await prisma.trip.create({ data: { userId, name: "Stay-only trip" } });
    await prisma.flight.create({
      data: {
        userId,
        tripId: tripA.id,
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 41.2974,
        arrLon: 2.0833,
        status: "flown",
        departureTime: new Date("2024-08-01T10:00:00.000Z"),
        arrivalTime: new Date("2024-08-01T12:00:00.000Z"),
      },
    });
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Separate Trip Hotel", type: "hotel", country: "Italy" },
    });
    await prisma.lodgingStay.create({
      data: {
        lodgingId: lodging.id,
        userId,
        tripId: tripB.id,
        checkIn: new Date("2024-09-01T00:00:00.000Z"),
        checkOut: new Date("2024-09-03T00:00:00.000Z"),
        status: "completed",
      },
    });

    const unlocked = await checkAndUpdateAchievements(userId);
    expect(unlocked.map((u) => u.achievement.code)).not.toContain("FLY_AND_STAY");

    await prisma.trip.deleteMany({ where: { id: { in: [tripA.id, tripB.id] } } });
  });
});
