import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { seedRealisticDemo } from "../seedDemo/realistic";

/**
 * Finding B6 of the independent review of 2026-09-17: the demo generators
 * anchored "now" to a hard-coded 2026-04-23. The demo account is reseeded
 * nightly on a public instance, so from the day that date passed, every
 * "upcoming" flight and cruise in it had already departed — the account
 * advertised a feature (what is coming up) with data that contradicted it,
 * and got worse every day.
 *
 * The realistic account (2026-09-26) keeps the rule: every date is relative
 * to the run's own instant. This freezes it far enough ahead that no fixed
 * date written today can pass for it.
 */
const FROZEN_NOW = new Date("2030-03-01T00:00:00Z");

describe("a demo seed run given its own 'now'", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "seedNowUser" } });
    userId = (
      await prisma.user.create({
        data: { username: "seedNowUser", passwordHash: await hashPassword("password123") },
      })
    ).id;
    await seedRealisticDemo(userId, FROZEN_NOW);
  }, 180_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("puts every scheduled flight after that instant, and every flown one before it", async () => {
    const flights = await prisma.flight.findMany({ where: { userId } });
    const scheduled = flights.filter((f) => f.status === "scheduled");
    expect(scheduled.length).toBeGreaterThan(0);
    for (const f of scheduled)
      expect(f.departureTime!.getTime()).toBeGreaterThan(FROZEN_NOW.getTime());
    for (const f of flights.filter((x) => x.status === "flown")) {
      expect(f.departureTime!.getTime()).toBeLessThan(FROZEN_NOW.getTime());
    }
  });

  it("spans the ten years before that instant", async () => {
    const first = await prisma.flight.findFirst({
      where: { userId },
      orderBy: { departureTime: "asc" },
    });
    expect(first!.departureTime!.getUTCFullYear()).toBe(2021);
  });

  it("puts the scheduled cruise, rides and stays after it", async () => {
    const cruise = await prisma.cruise.findFirst({ where: { userId, status: "scheduled" } });
    expect(cruise!.startDate!.getTime()).toBeGreaterThan(FROZEN_NOW.getTime());
    const rides = await prisma.railJourney.findMany({ where: { userId, status: "scheduled" } });
    expect(rides.length).toBeGreaterThan(0);
    for (const r of rides) expect(r.departureTime.getTime()).toBeGreaterThan(FROZEN_NOW.getTime());
    const stays = await prisma.lodgingStay.findMany({ where: { userId, status: "scheduled" } });
    for (const s of stays) expect(s.checkIn!.getTime()).toBeGreaterThan(FROZEN_NOW.getTime());
  });
});
