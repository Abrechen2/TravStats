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
});
