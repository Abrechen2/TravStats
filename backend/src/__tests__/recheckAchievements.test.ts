import { prisma } from '../db';
import { recheckAllAchievements } from '../scripts/recheckAchievements';
import { checkAndUpdateAchievements } from '../utils/achievements';

/**
 * The boot-time pass exists because the engine otherwise only runs on a flight/cruise
 * write. Without it, a user who adds nothing keeps a badge a scoring fix has invalidated.
 */

const AIRPORTS_10 = 'AIRPORTS_10'; // requirement: 10 distinct airports

interface Leg {
  dep: string;
  depLat: number;
  depLon: number;
  arr: string;
  arrLat: number;
  arrLon: number;
}

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
        flightNumber: `LH${300 + i}`,
        depIata: leg.dep,
        depLat: leg.depLat,
        depLon: leg.depLon,
        arrIata: leg.arr,
        arrLat: leg.arrLat,
        arrLon: leg.arrLon,
        departureTime: new Date(Date.UTC(2021, 0, 1 + i, 8, 0)),
        arrivalTime: new Date(Date.UTC(2021, 0, 1 + i, 14, 0)),
        status: 'flown',
      },
    });
  }
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { username: `recheck-test-${Date.now()}`, passwordHash: 'testhash' },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.userAchievement.deleteMany({ where: { userId } });
  await prisma.flight.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('recheckAllAchievements', () => {
  it('revokes a stale badge without the user touching anything', async () => {
    await seedFlights(6);
    await checkAndUpdateAchievements(userId);

    // Simulate the real-world case: the badge is held, but the data behind it is gone
    // (deleted flights, or a scoring bug that has since been fixed). The user never
    // saves anything again, so the engine is never triggered on their behalf.
    await prisma.flight.deleteMany({ where: { userId } });

    const stale = await prisma.userAchievement.findFirst({
      where: { userId, achievement: { code: AIRPORTS_10 } },
      include: { achievement: true },
    });
    expect(stale!.progress).toBeGreaterThanOrEqual(stale!.achievement.requirement);

    const { users, failed } = await recheckAllAchievements();
    expect(users).toBeGreaterThan(0);
    expect(failed).toBe(0);

    const after = await prisma.userAchievement.findFirst({
      where: { userId, achievement: { code: AIRPORTS_10 } },
      include: { achievement: true },
    });
    expect(after!.progress).toBe(0);
    expect(after!.progress).toBeLessThan(after!.achievement.requirement);
  });

  it('is idempotent — a second pass over unchanged data changes nothing', async () => {
    await seedFlights(6);
    await recheckAllAchievements();

    const first = await prisma.userAchievement.findFirst({
      where: { userId, achievement: { code: AIRPORTS_10 } },
      include: { achievement: true },
    });
    expect(first!.progress).toBeGreaterThanOrEqual(first!.achievement.requirement);

    await new Promise(resolve => setTimeout(resolve, 25));
    await recheckAllAchievements();

    const second = await prisma.userAchievement.findFirst({
      where: { userId, achievement: { code: AIRPORTS_10 } },
    });
    expect(second!.progress).toBe(first!.progress);
    // The write is skipped entirely, so even the unlock date is untouched.
    expect(second!.unlockedAt.getTime()).toBe(first!.unlockedAt.getTime());
  });
});
