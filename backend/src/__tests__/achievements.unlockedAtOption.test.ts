import { prisma } from "../db";
import { checkAndUpdateAchievements } from "../utils/achievements";

/**
 * `unlockedAt` as an option of the engine (board item realistic-demo-account
 * (c)): the demo seed replays its trips and dates each badge with the day of
 * the trip that earned it. What must hold for everyone else: without the
 * option a badge is dated NOW, and the option never moves a date a row
 * already carries.
 */

let userId: string;

async function flight(day: number): Promise<void> {
  await prisma.flight.create({
    data: {
      userId,
      airline: "Lufthansa",
      flightNumber: `LH${400 + day}`,
      depIata: "FRA",
      depLat: 50.0379,
      depLon: 8.5622,
      arrIata: "JFK",
      arrLat: 40.6413,
      arrLon: -73.7781,
      departureTime: new Date(Date.UTC(2018, 4, day, 8, 0)),
      arrivalTime: new Date(Date.UTC(2018, 4, day, 16, 0)),
      status: "flown",
    },
  });
}

const firstFlight = () =>
  prisma.userAchievement.findFirst({ where: { userId, achievement: { code: "FIRST_FLIGHT" } } });

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { username: `unlocked-at-${Date.now()}`, passwordHash: "testhash" },
  });
  userId = user.id;
});

afterEach(async () => {
  await prisma.user.delete({ where: { id: userId } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the date a badge is stamped with", () => {
  it("is now for every live caller", async () => {
    await flight(1);
    const before = Date.now();
    await checkAndUpdateAchievements(userId);
    const row = await firstFlight();
    expect(row?.unlockedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("is the given day for a replay, and a later run does not move it", async () => {
    await flight(1);
    const tripDay = new Date("2018-05-03T12:00:00Z");
    await checkAndUpdateAchievements(userId, { unlockedAt: tripDay });
    expect((await firstFlight())?.unlockedAt).toEqual(tripDay);

    await flight(9);
    await checkAndUpdateAchievements(userId, { unlockedAt: new Date("2018-05-10T12:00:00Z") });
    await checkAndUpdateAchievements(userId);
    expect((await firstFlight())?.unlockedAt).toEqual(tripDay);
  });
});
