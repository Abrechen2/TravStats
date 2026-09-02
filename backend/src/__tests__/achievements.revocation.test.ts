import { prisma } from '../db';
import { checkAndUpdateAchievements } from '../utils/achievements';

/**
 * The achievement engine used to `continue` on any already-unlocked achievement, so it
 * was never re-evaluated. A badge granted from data that was later deleted — or from a
 * scoring bug — could never be taken back. These tests pin the new behaviour:
 *
 *   - an achievement whose requirement is no longer met is revoked
 *   - one that is still met keeps its ORIGINAL unlock date (re-checking must not make it
 *     look freshly earned and reshuffle the trophy case on every new flight)
 *
 * Since 2026-09-02 they also pin what `unlocked_at` MEANS. It used to be
 * `NOT NULL DEFAULT now()`, so a plain progress row — 86 of a required 100 —
 * carried a date and read as an unlock that never happened. Held-ness has always
 * been derived from `progress >= requirement`, so nothing on screen was wrong;
 * the column was, and an audit of the table believed it.
 */

const AIRPORTS_10 = 'AIRPORTS_10'; // requirement: 10 distinct airports
const AIRPORTS_50 = 'AIRPORTS_50'; // far out of reach here — a pure progress row

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
  { dep: 'FRA', depLat: 50.0379, depLon: 8.5622, arr: 'JFK', arrLat: 40.6413, arrLon: -73.7781 },
  { dep: 'MUC', depLat: 48.3538, depLon: 11.7861, arr: 'LHR', arrLat: 51.47, arrLon: -0.4543 },
  { dep: 'CDG', depLat: 49.0097, depLon: 2.5479, arr: 'DXB', arrLat: 25.2532, arrLon: 55.3657 },
  { dep: 'AMS', depLat: 52.3105, depLon: 4.7683, arr: 'SIN', arrLat: 1.3644, arrLon: 103.9915 },
  { dep: 'ZRH', depLat: 47.4647, depLon: 8.5492, arr: 'HND', arrLat: 35.5494, arrLon: 139.7798 },
  { dep: 'VIE', depLat: 48.1103, depLon: 16.5697, arr: 'LAX', arrLat: 33.9416, arrLon: -118.4085 },
];

let userId: string;

async function seedFlights(count: number) {
  await prisma.flight.deleteMany({ where: { userId } });
  for (let i = 0; i < count; i++) {
    const leg = ROUTES[i];
    await prisma.flight.create({
      data: {
        userId,
        airline: 'Lufthansa',
        flightNumber: `LH${100 + i}`,
        depIata: leg.dep,
        depLat: leg.depLat,
        depLon: leg.depLon,
        arrIata: leg.arr,
        arrLat: leg.arrLat,
        arrLon: leg.arrLon,
        departureTime: new Date(Date.UTC(2020, 0, 1 + i, 8, 0)),
        arrivalTime: new Date(Date.UTC(2020, 0, 1 + i, 14, 0)),
        status: 'flown',
      },
    });
  }
}

async function progressOf(code: string): Promise<{ progress: number; requirement: number; unlockedAt: Date | null } | null> {
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

describe('achievement re-evaluation', () => {
  it('revokes an achievement once its requirement is no longer met', async () => {
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
    expect(after!.progress).toBe(4);
    // Below the requirement is what "revoked" means — there is no separate flag.
    expect(after!.progress).toBeLessThan(after!.requirement);
    // And the row says so. Leaving the old date behind would let the table go on
    // asserting an unlock that has been withdrawn.
    expect(after!.unlockedAt).toBeNull();
  });

  it('never dates a badge that was only ever tracked, not earned', async () => {
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

  it('keeps the original unlock date when re-checking an achievement still held', async () => {
    await seedFlights(6);
    await checkAndUpdateAchievements(userId);

    const first = await progressOf(AIRPORTS_10);
    expect(first!.progress).toBeGreaterThanOrEqual(first!.requirement);
    const originalDate = first!.unlockedAt!;

    // Wait long enough that a bumped timestamp would be visibly different.
    await new Promise(resolve => setTimeout(resolve, 25));

    // A later flight re-runs the engine. The badge is re-evaluated (that is the fix),
    // but it must not be re-dated.
    await checkAndUpdateAchievements(userId);

    const second = await progressOf(AIRPORTS_10);
    expect(second!.progress).toBeGreaterThanOrEqual(second!.requirement);
    expect(second!.unlockedAt!.getTime()).toBe(originalDate.getTime());
  });

  it('does not re-announce an achievement the user already holds', async () => {
    await seedFlights(6);
    await checkAndUpdateAchievements(userId); // first unlock

    const again = await checkAndUpdateAchievements(userId);
    const codes = again.map(a => a.achievement.code);
    expect(codes).not.toContain(AIRPORTS_10);
  });

  it('re-unlocks cleanly when the data comes back', async () => {
    await seedFlights(2);
    await checkAndUpdateAchievements(userId);
    const revoked = await progressOf(AIRPORTS_10);
    expect(revoked!.progress).toBe(4);
    expect(revoked!.unlockedAt).toBeNull();

    await seedFlights(6);
    const newly = await checkAndUpdateAchievements(userId);

    const after = await progressOf(AIRPORTS_10);
    expect(after!.progress).toBeGreaterThanOrEqual(after!.requirement);
    // It was revoked, so earning it again IS a new unlock and should be
    // announced — and dated, off the cleared column rather than the old date.
    expect(newly.map(a => a.achievement.code)).toContain(AIRPORTS_10);
    expect(after!.unlockedAt).toBeInstanceOf(Date);
  });
});
