import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { prisma } from '../db';
import { seedPortsFromCSV } from '../seedPortsFromCSV';

describe('seedPortsFromCSV', () => {
  beforeEach(async () => {
    // Wipe ALL rows (incl. isUserAdded) so each test starts clean. The
    // isUserAdded test below relies on Hamburg not pre-existing.
    await prisma.port.deleteMany({});
  });

  afterAll(async () => {
    // Leave the dev DB populated with the real seed data so other
    // workflows (dev server, manual smoke tests) see the expected catalog.
    await prisma.port.deleteMany({});
    await seedPortsFromCSV();
    await prisma.$disconnect();
  });

  it('inserts all rows from the CSV on a fresh DB', async () => {
    const count = await seedPortsFromCSV();
    expect(count).toBeGreaterThanOrEqual(50);
    const rows = await prisma.port.count();
    expect(rows).toBe(count);
  });

  it('is idempotent — running twice does not duplicate rows', async () => {
    const first = await seedPortsFromCSV();
    const second = await seedPortsFromCSV();
    expect(second).toBe(0);
    const rows = await prisma.port.count();
    expect(rows).toBe(first);
  });

  it('does not overwrite rows flagged isUserAdded', async () => {
    const p = await prisma.port.create({
      data: { name: 'Hamburg', city: 'Hamburg', country: 'Germany', unlocode: 'DEHAM', lat: 0, lon: 0, isUserAdded: true },
    });
    await seedPortsFromCSV();
    const reloaded = await prisma.port.findUnique({ where: { id: p.id } });
    expect(reloaded?.lat).toBe(0);
    expect(reloaded?.isUserAdded).toBe(true);
  });
});
