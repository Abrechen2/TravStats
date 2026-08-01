import { prisma } from '../db';
import { mergeTrips } from '../services/tripCleanupService';

describe('mergeTrips companion links', () => {
  let userId: string;

  beforeEach(async () => {
    await prisma.tripCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    const user = await prisma.user.create({
      data: { username: 'merge-companions', passwordHash: 'x' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.tripCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  // The invariant the whole dual write exists for: after any write path, a
  // trip's legacy array and its links must describe the same people.
  it('leaves the merged trip with links matching its unioned array', async () => {
    const target = await prisma.trip.create({
      data: { userId, name: 'Ziel', companions: ['Anna'] },
    });
    const source = await prisma.trip.create({
      data: { userId, name: 'Quelle', companions: ['Jonas'] },
    });

    await mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });

    const merged = await prisma.trip.findUniqueOrThrow({
      where: { id: target.id },
      include: { companionLinks: { include: { companion: true } } },
    });

    expect(merged.companions.sort()).toEqual(['Anna', 'Jonas']);
    expect(merged.companionLinks).toHaveLength(merged.companions.length);
    expect(merged.companionLinks.map((l) => l.companion.displayName).sort()).toEqual([
      'Anna',
      'Jonas',
    ]);
  });

  it('does not duplicate a companion both trips already shared', async () => {
    const target = await prisma.trip.create({
      data: { userId, name: 'Ziel', companions: ['Anna'] },
    });
    const source = await prisma.trip.create({
      data: { userId, name: 'Quelle', companions: ['anna'] },
    });

    await mergeTrips(userId, { tripIds: [target.id, source.id], targetId: target.id });

    const merged = await prisma.trip.findUniqueOrThrow({
      where: { id: target.id },
      include: { companionLinks: true },
    });

    expect(merged.companionLinks).toHaveLength(merged.companions.length);
    expect(merged.companionLinks).toHaveLength(1);
  });
});
