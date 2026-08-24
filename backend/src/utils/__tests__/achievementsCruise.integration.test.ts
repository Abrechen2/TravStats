import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { prisma } from '../../db';
import { checkAndUpdateAchievements } from '../achievements';
import { hashPassword } from '../password';
import { ensureAchievements } from '../../data/achievements';

describe('checkAndUpdateAchievements — cruise integration', () => {
  let userId: string;
  let portId: number;
  let shipId: number;

  beforeAll(async () => {
    await ensureAchievements();
    await prisma.user.deleteMany({ where: { username: 'cruiseachv' } });
    const u = await prisma.user.create({
      data: { username: 'cruiseachv', passwordHash: await hashPassword('password123') },
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
    const ship = await prisma.ship.upsert({
      where: { imo: '9781865' },
      update: {},
      create: {
        name: 'AIDAnova',
        imo: '9781865',
        cruiseLine: 'AIDA Cruises',
        isUserAdded: false,
      },
    });
    shipId = ship.id;
  });

  beforeEach(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.userAchievement.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.userAchievement.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('unlocks FIRST_CRUISE after creating one flown cruise', async () => {
    await prisma.cruise.create({
      data: {
        userId,
        shipId,
        cruiseLine: 'AIDA Cruises',
        status: 'flown',
        stops: { create: [{ portId, dayNumber: 1, isAtSea: false }] },
      },
    });
    const unlocked = await checkAndUpdateAchievements(userId);
    const codes = unlocked.map((u) => u.achievement.code);
    expect(codes).toContain('FIRST_CRUISE');
  });

  it('unlocks PORT_HOPPER_5 after 5 unique ports across cruises', async () => {
    // Create 5 ports + 1 cruise with all 5 stops
    const portRows = await Promise.all(
      ['P1', 'P2', 'P3', 'P4', 'P5'].map((n, i) =>
        prisma.port.create({ data: { name: n, lat: i, lon: i, isUserAdded: true } }),
      ),
    );
    await prisma.cruise.create({
      data: {
        userId,
        cruiseLine: 'Test',
        status: 'flown',
        stops: {
          create: portRows.map((p, i) => ({
            portId: p.id,
            dayNumber: i + 1,
            isAtSea: false,
          })),
        },
      },
    });
    const unlocked = await checkAndUpdateAchievements(userId);
    const codes = unlocked.map((u) => u.achievement.code);
    expect(codes).toContain('PORT_HOPPER_5');
    // clean up the extra ports
    await prisma.port.deleteMany({ where: { id: { in: portRows.map((p) => p.id) } } });
  });

  it('unlocks CRUISE_MEDITERRANEAN from a Med port', async () => {
    await prisma.cruise.create({
      data: {
        userId,
        cruiseLine: 'AIDA Cruises',
        status: 'flown',
        stops: { create: [{ portId, dayNumber: 1, isAtSea: false }] },
      },
    });
    const unlocked = await checkAndUpdateAchievements(userId);
    expect(unlocked.map((u) => u.achievement.code)).toContain('CRUISE_MEDITERRANEAN');
  });
  // #269 — the achievement ladder used to load cruises WITHOUT their legs, so
  // `calculateCruiseStats` fell back to a haversine chord for every leg while
  // the statistics page reported the routed sea distance. Two ports 6 km apart
  // with a 6000 km leg stored between them make the two numbers impossible to
  // confuse: only the leg-based figure crosses the 5000 km badge.
  it('measures cruise distance from the stored legs, not the straight-line chord', async () => {
    const near = await prisma.port.create({
      data: { name: 'Badalona', lat: 41.4, lon: 2.2, isUserAdded: true },
    });
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        cruiseLine: 'AIDA Cruises',
        status: 'flown',
        stops: {
          create: [
            { portId, dayNumber: 1, isAtSea: false },
            { portId: near.id, dayNumber: 2, isAtSea: false },
          ],
        },
      },
    });
    await prisma.cruiseLeg.create({
      data: {
        cruiseId: cruise.id,
        ordinal: 0,
        fromPortId: portId,
        toPortId: near.id,
        distanceKm: 6000,
        method: 'marnet',
        routerVersion: 'test',
      },
    });

    const unlocked = await checkAndUpdateAchievements(userId);
    expect(unlocked.map((u) => u.achievement.code)).toContain('CRUISE_DISTANCE_5000');

    await prisma.cruise.delete({ where: { id: cruise.id } });
    await prisma.port.delete({ where: { id: near.id } });
  });

});
