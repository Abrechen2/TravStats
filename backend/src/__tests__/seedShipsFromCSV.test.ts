import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { prisma } from '../db';
import { seedShipsFromCSV } from '../seedShipsFromCSV';

describe('seedShipsFromCSV', () => {
  beforeEach(async () => {
    // Wipe ALL rows (incl. isUserAdded) so each test starts clean. The
    // isUserAdded test below relies on AIDAnova not pre-existing.
    await prisma.ship.deleteMany({});
  });

  afterAll(async () => {
    // Leave the dev DB populated with the real seed data.
    await prisma.ship.deleteMany({});
    await seedShipsFromCSV();
    await prisma.$disconnect();
  });

  it('inserts rows from CSV', async () => {
    const count = await seedShipsFromCSV();
    expect(count).toBeGreaterThanOrEqual(20);
  });

  it('is idempotent', async () => {
    await seedShipsFromCSV();
    const second = await seedShipsFromCSV();
    expect(second).toBe(0);
  });

  it('respects isUserAdded flag', async () => {
    const s = await prisma.ship.create({
      data: { name: 'AIDAnova', imo: '9781865', cruiseLine: 'AIDA Cruises', isUserAdded: true },
    });
    await seedShipsFromCSV();
    const reloaded = await prisma.ship.findUnique({ where: { id: s.id } });
    expect(reloaded?.isUserAdded).toBe(true);
  });
});
