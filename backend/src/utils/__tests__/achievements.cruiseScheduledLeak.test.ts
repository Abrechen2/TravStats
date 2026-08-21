// Regression: planned/scheduled bookings must not unlock achievements.
// Mirrors achievementsCruise.integration.test.ts (which only ever seeds
// `flown` cruises) and achievementsLodging.integration.test.ts's FLY_AND_STAY
// cases, but proves the negative: a booking that hasn't happened yet must
// leave the engine untouched.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { prisma } from '../../db';
import { checkAndUpdateAchievements } from '../achievements';
import { hashPassword } from '../password';
import { ensureAchievements } from '../../data/achievements';

describe('checkAndUpdateAchievements — scheduled-booking leak regression', () => {
  let userId: string;
  let portId: number;

  beforeAll(async () => {
    await ensureAchievements();
    await prisma.user.deleteMany({ where: { username: 'schedbookleak' } });
    const u = await prisma.user.create({
      data: { username: 'schedbookleak', passwordHash: await hashPassword('password123') },
    });
    userId = u.id;
    const port = await prisma.port.upsert({
      where: { unlocode: 'ESBCN' },
      update: {},
      create: {
        name: 'Barcelona',
        unlocode: 'ESBCN',
        region: 'mediterranean',
        country: 'Spain',
        lat: 41.35,
        lon: 2.17,
        isUserAdded: false,
      },
    });
    portId = port.id;
  });

  beforeEach(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.userAchievement.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.userAchievement.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('unlocks no cruise achievement from a single scheduled cruise with 5 stops', async () => {
    const portRows = await Promise.all(
      ['P1', 'P2', 'P3', 'P4'].map((n, i) =>
        prisma.port.create({ data: { name: n, lat: i, lon: i, isUserAdded: true } }),
      ),
    );
    await prisma.cruise.create({
      data: {
        userId,
        cruiseLine: 'Test',
        status: 'scheduled',
        stops: {
          create: [
            { portId, dayNumber: 1, isAtSea: false },
            ...portRows.map((p, i) => ({
              portId: p.id,
              dayNumber: i + 2,
              isAtSea: false,
            })),
          ],
        },
      },
    });

    await checkAndUpdateAchievements(userId);
    const unlocked = await prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
    });
    const cruiseUnlocks = unlocked.filter((u) => u.achievement.domain === 'cruise');
    expect(cruiseUnlocks).toEqual([]);

    await prisma.port.deleteMany({ where: { id: { in: portRows.map((p) => p.id) } } });
  });

  it('does NOT unlock FLY_AND_STAY from a scheduled flight + a future lodging stay in the same trip', async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: 'Not-Yet Trip' },
    });
    await prisma.flight.create({
      data: {
        userId,
        tripId: trip.id,
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 41.2974,
        arrLon: 2.0833,
        status: 'scheduled',
        departureTime: new Date('2027-07-01T10:00:00.000Z'),
        arrivalTime: new Date('2027-07-01T12:00:00.000Z'),
      },
    });
    const lodging = await prisma.lodging.create({
      data: { userId, name: 'Future Hotel', type: 'hotel', country: 'Spain' },
    });
    await prisma.lodgingStay.create({
      data: {
        lodgingId: lodging.id,
        userId,
        tripId: trip.id,
        checkIn: new Date('2027-07-01T00:00:00.000Z'),
        checkOut: new Date('2027-07-03T00:00:00.000Z'),
        status: 'scheduled',
      },
    });

    const unlocked = await checkAndUpdateAchievements(userId);
    expect(unlocked.map((u) => u.achievement.code)).not.toContain('FLY_AND_STAY');

    const persisted = await prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
    });
    expect(persisted.map((u) => u.achievement.code)).not.toContain('FLY_AND_STAY');

    await prisma.trip.delete({ where: { id: trip.id } });
  });
});
