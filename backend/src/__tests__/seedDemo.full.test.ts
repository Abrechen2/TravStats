import { prisma } from "../db";
import { runDemoSeed } from "../seedDemoAccount";

/**
 * The whole standard demo seed, run twice. Every domain must have rows, and a
 * second run (the nightly reset) must land on exactly the same counts.
 * Removes the "demo" user afterwards — it is disposable by definition.
 */
describe("the standard demo seed", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "demo" } });
  });

  it("fills every domain and is idempotent", async () => {
    const first = await runDemoSeed();
    for (const [domain, count] of Object.entries(first.counts)) {
      // Two-argument expect(value, message) is not used here (see R3) —
      // a labelled throw gives the same "which domain failed" signal.
      if (!(count > 0)) throw new Error(`expected ${domain} to have rows, got ${count}`);
    }
    const second = await runDemoSeed();
    expect(second.userId).toBe(first.userId);
    expect(second.counts).toEqual(first.counts);

    // ADR 0002 phase 2: a fresh demo is never a phase-3b backfill case —
    // every dated row carries its time-model columns.
    const userId = second.userId;
    const missing = {
      flights: await prisma.flight.count({ where: { userId, depTimezone: null } }),
      stays: await prisma.lodgingStay.count({
        where: { userId, checkIn: { not: null }, checkInDate: null },
      }),
      visits: await prisma.placeVisit.count({
        where: { userId, visitedAt: { not: null }, visitedPrecision: null },
      }),
      cruiseStops: await prisma.cruiseStop.count({
        where: {
          cruise: { userId },
          OR: [{ date: { not: null } }, { arrivalTime: { not: null } }],
          timePrecision: null,
        },
      }),
      tripStops: await prisma.tripStop.count({
        where: {
          OR: [{ trip: { userId } }, { route: { userId } }],
          startDate: { not: null },
          precision: null,
        },
      }),
      trips: await prisma.trip.count({
        where: { userId, startDate: { not: null }, startDay: null },
      }),
      journal: await prisma.tripJournalEntry.count({ where: { trip: { userId }, day: null } }),
      rail: await prisma.railJourney.count({ where: { userId, depPrecision: null } }),
    };
    expect(missing).toEqual({
      flights: 0,
      stays: 0,
      visits: 0,
      cruiseStops: 0,
      tripStops: 0,
      trips: 0,
      journal: 0,
      rail: 0,
    });

    // Board item realistic-demo-account (c): every badge used to carry the
    // seed day. The seed replays its trips in order and dates each badge with
    // the last day of the trip that earned it.
    const badges = await prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
    });
    const earned = badges.filter((b) => b.unlockedAt !== null);
    expect(earned.length).toBeGreaterThan(50);
    const seedDay = new Date().toISOString().slice(0, 10);
    const days = new Set(earned.map((b) => b.unlockedAt!.toISOString().slice(0, 10)));
    expect(days.size).toBeGreaterThan(20);
    expect(earned.filter((b) => b.unlockedAt!.toISOString().startsWith(seedDay))).toEqual([]);
    expect(earned.filter((b) => b.unlockedAt!.getTime() > Date.now())).toEqual([]);
    // A replay must not leave a badge dated but not held (a measure that rose
    // mid-replay and fell by the end would read "last held on …").
    expect(
      earned.filter((b) => b.progress < b.achievement.requirement).map((b) => b.achievement.code)
    ).toEqual([]);
    // The first flight's badge is dated with that flight's trip, not today.
    const firstFlown = await prisma.flight.findFirstOrThrow({
      where: { userId, status: { in: ["flown", "historical"] } },
      orderBy: { departureTime: "asc" },
      include: { trip: true },
    });
    const firstFlightBadge = earned.find((b) => b.achievement.code === "FIRST_FLIGHT");
    expect(firstFlightBadge?.unlockedAt!.getTime()).toBe(
      firstFlown.trip!.endDate!.getTime() + 12 * 3_600_000
    );
  }, 240_000);
});
