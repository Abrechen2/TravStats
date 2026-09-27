import { prisma } from "../../db";
import { sweepStatuses } from "../statusSweep";

/**
 * ADR 0002 D4: "is it over" for a DAY-dated stay is asked in the user's
 * profile zone. At 2027-01-01T11:00Z it is already 2 January in Kiritimati
 * (+14): a stay checking out on 2 January is over for a user there, and still
 * running for a user whose "today" is UTC.
 */
const USERS = ["sweepzonekiri", "sweepzoneutc"];
const NOW = new Date("2027-01-01T11:00:00.000Z");

describe("sweepStatuses — day columns in the profile zone", () => {
  let kiri: string;
  let utc: string;

  const cleanup = async (): Promise<void> => {
    await prisma.lodgingStay.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.lodging.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.userSettings.deleteMany({ where: { user: { username: { in: USERS } } } });
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
  };

  beforeAll(async () => {
    await cleanup();
    kiri = (await prisma.user.create({ data: { username: USERS[0], passwordHash: "x" } })).id;
    utc = (await prisma.user.create({ data: { username: USERS[1], passwordHash: "x" } })).id;
    await prisma.userSettings.create({
      data: { userId: kiri, data: { display: { timezone: "Pacific/Kiritimati" } } },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const stay = async (userId: string) => {
    const lodging = await prisma.lodging.create({ data: { userId, name: "Hotel" } });
    return prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2026-12-28T00:00:00.000Z"),
        checkOut: new Date("2027-01-02T00:00:00.000Z"),
        status: "in_progress",
      },
    });
  };

  it("completes the stay where check-out day has begun, and only there", async () => {
    const there = await stay(kiri);
    const here = await stay(utc);
    await sweepStatuses(NOW);
    const status = async (id: string) =>
      (await prisma.lodgingStay.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(there.id)).toBe("completed");
    expect(await status(here.id)).toBe("in_progress");
  });
});
