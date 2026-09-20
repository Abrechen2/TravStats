import { prisma } from "../db";
import { checkAndUpdateAchievements } from "../utils/achievements";

/**
 * The achievement engine used to `continue` on any already-unlocked achievement, so it
 * was never re-evaluated. These tests pin what re-evaluation may and may not do:
 *
 *   - the MEASURE is re-derived every run and may fall — and with it the badge:
 *     held-ness is the live measure (owner ruling 2026-09-20, "the live state counts")
 *   - the DATE survives: `unlockedAt` is never cleared or rewritten, however far the
 *     measure falls, and a recovery keeps the ORIGINAL date (re-checking must not make
 *     a badge look freshly earned and reshuffle the trophy case on every new flight)
 *
 * Why the date is guarded separately: the integrity audit of 2026-09-19 restored the
 * 2.6.2 prod mirror, booted it, and watched AWAY_SHARE_25 — earned 2026-09-03 — come
 * back at progress 24 with `unlockedAt` NULL, because the away-share denominator grows
 * with every day of the year. Losing the badge for the moment is the rule; losing the
 * date was the defect.
 *
 * Since 2026-09-02 they also pin what `unlocked_at` MEANS. It used to be
 * `NOT NULL DEFAULT now()`, so a plain progress row — 86 of a required 100 —
 * carried a date and read as an unlock that never happened. That is why the column
 * can now carry the held-ness it does.
 */

const AIRPORTS_10 = "AIRPORTS_10"; // requirement: 10 distinct airports
const AIRPORTS_50 = "AIRPORTS_50"; // far out of reach here — a pure progress row

interface Leg {
  dep: string;
  depLat: number;
  depLon: number;
  arr: string;
  arrLat: number;
  arrLon: number;
}

// Each leg touches two airports, so six of them give twelve distinct codes.
const ROUTES: Leg[] = [
  { dep: "FRA", depLat: 50.0379, depLon: 8.5622, arr: "JFK", arrLat: 40.6413, arrLon: -73.7781 },
  { dep: "MUC", depLat: 48.3538, depLon: 11.7861, arr: "LHR", arrLat: 51.47, arrLon: -0.4543 },
  { dep: "CDG", depLat: 49.0097, depLon: 2.5479, arr: "DXB", arrLat: 25.2532, arrLon: 55.3657 },
  { dep: "AMS", depLat: 52.3105, depLon: 4.7683, arr: "SIN", arrLat: 1.3644, arrLon: 103.9915 },
  { dep: "ZRH", depLat: 47.4647, depLon: 8.5492, arr: "HND", arrLat: 35.5494, arrLon: 139.7798 },
  { dep: "VIE", depLat: 48.1103, depLon: 16.5697, arr: "LAX", arrLat: 33.9416, arrLon: -118.4085 },
];

let userId: string;

async function seedFlights(count: number) {
  await prisma.flight.deleteMany({ where: { userId } });
  for (let i = 0; i < count; i++) {
    const leg = ROUTES[i];
    await prisma.flight.create({
      data: {
        userId,
        airline: "Lufthansa",
        flightNumber: `LH${100 + i}`,
        depIata: leg.dep,
        depLat: leg.depLat,
        depLon: leg.depLon,
        arrIata: leg.arr,
        arrLat: leg.arrLat,
        arrLon: leg.arrLon,
        departureTime: new Date(Date.UTC(2020, 0, 1 + i, 8, 0)),
        arrivalTime: new Date(Date.UTC(2020, 0, 1 + i, 14, 0)),
        status: "flown",
      },
    });
  }
}

async function progressOf(
  code: string
): Promise<{ progress: number; requirement: number; unlockedAt: Date | null } | null> {
  const row = await prisma.userAchievement.findFirst({
    where: { userId, achievement: { code } },
    include: { achievement: true },
  });
  if (!row) return null;
  return {
    progress: row.progress,
    requirement: row.achievement.requirement,
    unlockedAt: row.unlockedAt,
  };
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      username: `revocation-test-${Date.now()}`,
      passwordHash: "testhash",
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.userAchievement.deleteMany({ where: { userId } });
  await prisma.flight.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("achievement re-evaluation", () => {
  it("lowers the measure and keeps only the unlock date when the requirement is no longer met", async () => {
    // Six round trips = twelve distinct airports -> AIRPORTS_10 (needs 10) unlocks.
    await seedFlights(6);
    await checkAndUpdateAchievements(userId);

    const unlocked = await progressOf(AIRPORTS_10);
    expect(unlocked).not.toBeNull();
    expect(unlocked!.progress).toBeGreaterThanOrEqual(unlocked!.requirement);

    // The user deletes most of their flights — two round trips leave four airports.
    await seedFlights(2);
    await checkAndUpdateAchievements(userId);

    const after = await progressOf(AIRPORTS_10);
    expect(after).not.toBeNull();
    // The measure is re-derived and falls — it is a measurement, and the
    // progress bar has to be able to say so.
    expect(after!.progress).toBe(4);
    expect(after!.progress).toBeLessThan(after!.requirement);
    // The badge does not. This is the assertion that fails on the pre-2026-09-19
    // engine, which cleared the column here.
    expect(after!.unlockedAt).toBeInstanceOf(Date);
    expect(after!.unlockedAt!.getTime()).toBe(unlocked!.unlockedAt!.getTime());
  });

  it("never dates a badge that was only ever tracked, not earned", async () => {
    // The defect behind "103 badges stand unlocked with a progress value below
    // their own requirement": `unlocked_at` was NOT NULL DEFAULT now(), so the
    // progress row created the moment a measure moved off zero carried a date.
    // Read as an unlock date it inverted the ladder — a 100-badge sitting at 86
    // appeared to predate the 50-badge that was genuinely earned later.
    await seedFlights(6);
    await checkAndUpdateAchievements(userId);

    const tracked = await progressOf(AIRPORTS_50);
    expect(tracked).not.toBeNull();
    expect(tracked!.progress).toBeLessThan(tracked!.requirement);
    expect(tracked!.unlockedAt).toBeNull();

    // The badge actually earned off the same twelve airports carries one.
    const held = await progressOf(AIRPORTS_10);
    expect(held!.progress).toBeGreaterThanOrEqual(held!.requirement);
    expect(held!.unlockedAt).toBeInstanceOf(Date);
  });

  it("keeps the original unlock date when re-checking an achievement still held", async () => {
    await seedFlights(6);
    await checkAndUpdateAchievements(userId);

    const first = await progressOf(AIRPORTS_10);
    expect(first!.progress).toBeGreaterThanOrEqual(first!.requirement);
    const originalDate = first!.unlockedAt!;

    // Wait long enough that a bumped timestamp would be visibly different.
    await new Promise((resolve) => setTimeout(resolve, 25));

    // A later flight re-runs the engine. The badge is re-evaluated (that is the fix),
    // but it must not be re-dated.
    await checkAndUpdateAchievements(userId);

    const second = await progressOf(AIRPORTS_10);
    expect(second!.progress).toBeGreaterThanOrEqual(second!.requirement);
    expect(second!.unlockedAt!.getTime()).toBe(originalDate.getTime());
  });

  it("does not re-announce an achievement the user already holds", async () => {
    await seedFlights(6);
    await checkAndUpdateAchievements(userId); // first unlock

    const again = await checkAndUpdateAchievements(userId);
    const codes = again.map((a) => a.achievement.code);
    expect(codes).not.toContain(AIRPORTS_10);
  });

  it("recovers the measure without re-announcing a badge that was never lost", async () => {
    await seedFlights(6);
    await checkAndUpdateAchievements(userId);
    const earned = await progressOf(AIRPORTS_10);
    const originalDate = earned!.unlockedAt!;

    await seedFlights(2);
    await checkAndUpdateAchievements(userId);
    const dipped = await progressOf(AIRPORTS_10);
    expect(dipped!.progress).toBe(4);
    expect(dipped!.unlockedAt!.getTime()).toBe(originalDate.getTime());

    await seedFlights(6);
    const newly = await checkAndUpdateAchievements(userId);

    const after = await progressOf(AIRPORTS_10);
    expect(after!.progress).toBeGreaterThanOrEqual(after!.requirement);
    // Nothing was taken away, so nothing is handed back: no second popup, and
    // the original date stands.
    expect(newly.map((a) => a.achievement.code)).not.toContain(AIRPORTS_10);
    expect(after!.unlockedAt!.getTime()).toBe(originalDate.getTime());
  });
});
