import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { stillEligible } from "../eligibility";

const COORDS = { depLat: 1, depLon: 1, arrLat: 2, arrLon: 2 };

describe("stillEligible — the check right before a send", () => {
  let userId: string;
  let flightId: string;
  const departure = new Date("2026-11-10T12:00:00.000Z");
  const args = () => ({
    userId,
    domain: "flight" as const,
    entryId: flightId,
    hours: 24,
    channel: "mail" as const,
    anchorKey: departure.toISOString(),
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "elig_a" } });
    userId = (
      await prisma.user.create({
        data: {
          username: "elig_a",
          passwordHash: await hashPassword("password123"),
          notificationEmail: "e@example.com",
          notifyBefore24h: true,
        },
      })
    ).id;
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, data: {}, enabledDomains: ["flight"] },
      update: { enabledDomains: ["flight"] },
    });
    flightId = (
      await prisma.flight.create({
        data: {
          userId,
          status: "scheduled",
          departureTime: departure,
          flightNumber: "XX1",
          ...COORDS,
        },
      })
    ).id;
  });
  beforeEach(async () => {
    await prisma.flight.update({
      where: { id: flightId },
      data: { status: "scheduled", departureTime: departure },
    });
    await prisma.reminderPreference.deleteMany({ where: { userId } });
    await prisma.userSettings.update({ where: { userId }, data: { enabledDomains: ["flight"] } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("holds while nothing changed", async () => {
    expect(await stillEligible(args())).toBe(true);
  });

  it("fails when the flight was cancelled in between", async () => {
    await prisma.flight.update({ where: { id: flightId }, data: { status: "cancelled" } });
    expect(await stillEligible(args())).toBe(false);
  });

  it("fails when the flight was deleted", async () => {
    const gone = await prisma.flight.create({
      data: { userId, status: "scheduled", departureTime: departure, ...COORDS },
    });
    await prisma.flight.delete({ where: { id: gone.id } });
    expect(await stillEligible({ ...args(), entryId: gone.id })).toBe(false);
  });

  it("fails when the departure moved after the finder read it", async () => {
    await prisma.flight.update({
      where: { id: flightId },
      data: { departureTime: new Date(departure.getTime() + 3_600_000) },
    });
    expect(await stillEligible(args())).toBe(false);
  });

  it("fails when the domain was disabled, the lead removed or the channel changed", async () => {
    const pref = (data: object) =>
      prisma.reminderPreference.upsert({
        where: { userId_domain: { userId, domain: "flight" } },
        create: {
          userId,
          domain: "flight",
          enabled: true,
          leadHours: [24],
          channel: "both",
          ...data,
        },
        update: data,
      });
    await pref({});
    expect(await stillEligible(args())).toBe(true);
    await pref({ enabled: false });
    expect(await stillEligible(args())).toBe(false);
    await pref({ enabled: true, leadHours: [2] });
    expect(await stillEligible(args())).toBe(false);
    await pref({ leadHours: [24], channel: "app" });
    expect(await stillEligible(args())).toBe(false); // mail is no longer chosen
    expect(await stillEligible({ ...args(), channel: "app" })).toBe(true);
    await prisma.userSettings.update({ where: { userId }, data: { enabledDomains: ["cruise"] } });
    expect(await stillEligible({ ...args(), channel: "app" })).toBe(false);
  });
});
