import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { ensureUserSettings } from "../../../seedDemoAccount";
import { seedRealisticDemo } from "../../../seedDemo/realistic";
import { fillSeededTimeColumns } from "../../timeModel/seedTimeColumns";
import { buildTimeMigrationReport } from "../report";
import { runTimeModelBackfill } from "../runner";

/**
 * The realistic demo account already carries the new time columns — the seed
 * derives them right after it writes (`fillSeededTimeColumns`). The backfill
 * must leave every one of those rows exactly as it is and write no ledger row
 * for them, and the report must say they were already filled, not that
 * nothing happened.
 */

jest.setTimeout(240_000);

let userId: string;
let fetchSpy: jest.SpyInstance;

/** The new time columns of every demo row, in a stable order. */
async function newColumns(): Promise<string> {
  const byId = { orderBy: { id: "asc" as const } };
  return JSON.stringify({
    flights: await prisma.flight.findMany({
      where: { userId },
      ...byId,
      select: {
        id: true,
        depTimezone: true,
        arrTimezone: true,
        depPrecision: true,
        arrPrecision: true,
        updatedAt: true,
      },
    }),
    rail: await prisma.railJourney.findMany({
      where: { userId },
      ...byId,
      select: { id: true, depPrecision: true, arrPrecision: true },
    }),
    visits: await prisma.placeVisit.findMany({
      where: { userId },
      ...byId,
      select: { id: true, visitedAtUtc: true, visitedZone: true, visitedPrecision: true },
    }),
    stays: await prisma.lodgingStay.findMany({
      where: { userId },
      ...byId,
      select: { id: true, checkInDate: true, checkOutDate: true, checkInAt: true, stayZone: true },
    }),
    stops: await prisma.cruiseStop.findMany({
      where: { cruise: { userId } },
      ...byId,
      select: { id: true, arrivalUtc: true, stopZone: true, stopDate: true, timePrecision: true },
    }),
    cruises: await prisma.cruise.findMany({
      where: { userId },
      ...byId,
      select: { id: true, startDay: true, endDay: true, startZone: true },
    }),
    trips: await prisma.trip.findMany({
      where: { userId },
      ...byId,
      select: { id: true, startDay: true, endDay: true, startZone: true },
    }),
    tripStops: await prisma.tripStop.findMany({
      where: { OR: [{ trip: { userId } }, { route: { userId } }] },
      ...byId,
      select: { id: true, startUtc: true, stopZone: true, precision: true },
    }),
    journal: await prisma.tripJournalEntry.findMany({
      where: { trip: { userId } },
      ...byId,
      select: { id: true, day: true },
    }),
  });
}

beforeAll(async () => {
  await prisma.timeMigrationLedger.deleteMany({});
  await prisma.user.deleteMany({ where: { username: "tmDemoSeedUser" } });
  userId = (
    await prisma.user.create({
      data: { username: "tmDemoSeedUser", passwordHash: await hashPassword("password123") },
    })
  ).id;
  await ensureUserSettings(userId);
  fetchSpy = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
  await seedRealisticDemo(userId, new Date("2026-09-27T12:00:00.000Z"));
  await fillSeededTimeColumns(userId);
}, 240_000);

afterAll(async () => {
  fetchSpy.mockRestore();
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.timeMigrationLedger.deleteMany({});
  await prisma.adminSettings.updateMany({ data: { timeModelBackfillAt: null } });
});

describe("the backfill over the realistic demo account", () => {
  it("leaves every seeded row unchanged, writes no ledger row for it, and says so", async () => {
    const before = await newColumns();
    await runTimeModelBackfill();

    expect(await newColumns()).toBe(before);
    expect(await prisma.timeMigrationLedger.count({ where: { userId } })).toBe(0);

    const report = await buildTimeMigrationReport();
    const filled = Object.fromEntries(report.tables.map((t) => [t.table, t.alreadyFilled]));
    const flights = await prisma.flight.count({ where: { userId } });
    const visits = await prisma.placeVisit.count({ where: { userId, visitedAt: { not: null } } });
    expect(flights).toBeGreaterThan(0);
    expect(filled.flights).toBeGreaterThanOrEqual(flights);
    expect(filled.place_visits).toBeGreaterThanOrEqual(visits);
    expect(filled.lodging_stays).toBeGreaterThan(0);
    expect(filled.cruise_stops).toBeGreaterThan(0);
  });
});
