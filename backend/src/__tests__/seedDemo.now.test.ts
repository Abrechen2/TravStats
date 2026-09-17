import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { loadPools, seedCruises, seedFlights } from "../seedDemoAccount";

/**
 * Finding B6 of the independent review of 2026-09-17: both generators anchored
 * "now" to a hard-coded 2026-04-23. The demo account is reseeded nightly on a
 * public instance, so from the day that date passed, every "upcoming" flight
 * and cruise in it had already departed — the account advertised a feature
 * (what is coming up) with data that contradicted it, and got worse every day.
 *
 * The instant is a parameter now. This freezes it far enough ahead that the
 * old hard-coded date cannot pass for it.
 */
const FROZEN_NOW = new Date("2030-03-01T00:00:00Z");

describe("a seed run given its own 'now'", () => {
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "seedNowUser" } });
    userId = (
      await prisma.user.create({
        data: { username: "seedNowUser", passwordHash: await hashPassword("password123") },
      })
    ).id;
    const { airports, ships, ports } = await loadPools();
    await seedFlights(userId, airports, FROZEN_NOW);
    await seedCruises(userId, ships, ports, FROZEN_NOW);
  }, 180_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("puts every scheduled flight after that instant", async () => {
    const scheduled = await prisma.flight.findMany({ where: { userId, status: "scheduled" } });
    expect(scheduled.length).toBeGreaterThan(0);
    for (const flight of scheduled) {
      if (flight.departureTime === null || flight.departureTime <= FROZEN_NOW) {
        throw new Error(
          `a scheduled flight departs ${flight.departureTime?.toISOString() ?? "never"}, ` +
            `which is not after ${FROZEN_NOW.toISOString()}`,
        );
      }
    }
  });

  it("puts every flown flight before it", async () => {
    const flown = await prisma.flight.findMany({ where: { userId, status: "flown" } });
    expect(flown.length).toBeGreaterThan(0);
    for (const flight of flown) {
      if (flight.departureTime !== null && flight.departureTime > FROZEN_NOW) {
        throw new Error(
          `a flown flight departs ${flight.departureTime.toISOString()}, which is still ahead`,
        );
      }
    }
  });

  it("puts every scheduled cruise after it", async () => {
    const scheduled = await prisma.cruise.findMany({ where: { userId, status: "scheduled" } });
    expect(scheduled.length).toBeGreaterThan(0);
    for (const cruise of scheduled) {
      expect(cruise.startDate.getTime()).toBeGreaterThan(FROZEN_NOW.getTime());
    }
  });
});
