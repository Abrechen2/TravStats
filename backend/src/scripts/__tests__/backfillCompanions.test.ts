import { prisma } from '../../db';
import { backfillCompanions } from '../backfillCompanions';

describe('backfillCompanions', () => {
  let userId: string;

  beforeEach(async () => {
    await prisma.flightCompanion.deleteMany();
    await prisma.tripCompanion.deleteMany();
    await prisma.cruiseCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.cruise.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    const user = await prisma.user.create({
      data: { username: 'backfill-companions', passwordHash: 'x' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.flightCompanion.deleteMany();
    await prisma.tripCompanion.deleteMany();
    await prisma.cruiseCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.cruise.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  const legacyFlight = (companions: string[]) =>
    prisma.flight.create({
      // depLat/depLon/arrLat/arrLon are required (non-nullable, no default) on
      // Flight; the brief's literal test snippet omits them, so they are added
      // here with dummy values to satisfy the schema. Not part of the brief.
      data: { userId, flightNumber: 'LH400', companions, depLat: 0, depLon: 0, arrLat: 0, arrLon: 0 },
    });

  it('reproduces the legacy array exactly, in order', async () => {
    const flight = await legacyFlight(['Anna', 'Jonas']);
    await backfillCompanions();

    const links = await prisma.flightCompanion.findMany({
      where: { flightId: flight.id },
      include: { companion: true },
      orderBy: { position: 'asc' },
    });
    expect(links.map((l) => l.companion.displayName)).toEqual(['Anna', 'Jonas']);
  });

  it('is idempotent', async () => {
    await legacyFlight(['Anna', 'Jonas']);
    await backfillCompanions();
    const afterFirst = await prisma.flightCompanion.count();
    await backfillCompanions();
    expect(await prisma.flightCompanion.count()).toBe(afterFirst);
    expect(await prisma.companion.count()).toBe(2);
  });

  it('drops blank entries but keeps odd real ones', async () => {
    await legacyFlight(['  ', 'MUELLER/ANNA MS']);
    await backfillCompanions();
    const names = (await prisma.companion.findMany()).map((c) => c.displayName);
    expect(names).toEqual(['MUELLER/ANNA MS']);
  });

  it('collapses spellings that share an identity into one companion', async () => {
    await legacyFlight(['Anna']);
    await legacyFlight(['  anna ']);
    await backfillCompanions();
    expect(await prisma.companion.count({ where: { userId } })).toBe(1);
  });

  it('backfills trips and cruises too, not only flights', async () => {
    const trip = await prisma.trip.create({
      data: { userId, name: 'Legacy Trip', companions: ['Bea', 'Cem'] },
    });
    const cruise = await prisma.cruise.create({
      data: { userId, companions: ['Dora'] },
    });
    await backfillCompanions();

    const tripLinks = await prisma.tripCompanion.findMany({
      where: { tripId: trip.id },
      include: { companion: true },
      orderBy: { position: 'asc' },
    });
    expect(tripLinks.map((l) => l.companion.displayName)).toEqual(['Bea', 'Cem']);

    const cruiseLinks = await prisma.cruiseCompanion.findMany({
      where: { cruiseId: cruise.id },
      include: { companion: true },
      orderBy: { position: 'asc' },
    });
    expect(cruiseLinks.map((l) => l.companion.displayName)).toEqual(['Dora']);
  });

  it('keeps the most frequent trimmed spelling as displayName across records', async () => {
    await legacyFlight(['Anna']);
    await legacyFlight(['Anna']);
    await legacyFlight(['anna']);
    await backfillCompanions();

    const companion = await prisma.companion.findFirst({ where: { userId } });
    expect(companion?.displayName).toBe('Anna');
  });

  it('breaks frequency ties by the lexicographically smaller trimmed spelling', async () => {
    // Equal counts (one record each) but "Zoe" is created before "zoe" is
    // processed only by luck of UUID ordering -- the point of this test is
    // that the winner is decided by the tie-break rule, not by which record
    // happened to be resolved last.
    await legacyFlight(['Zoe']);
    await legacyFlight(['zoe']);
    await backfillCompanions();

    const companion = await prisma.companion.findFirst({ where: { userId } });
    expect(companion?.displayName).toBe('Zoe');
  });

  it('is a true no-op on a second run: no companion updatedAt changes', async () => {
    await legacyFlight(['Anna', 'Jonas']);
    await backfillCompanions();

    const before = await prisma.companion.findMany({
      where: { userId },
      orderBy: { canonicalName: 'asc' },
      select: { id: true, updatedAt: true },
    });
    expect(before).toHaveLength(2);

    await backfillCompanions();

    const after = await prisma.companion.findMany({
      where: { userId },
      orderBy: { canonicalName: 'asc' },
      select: { id: true, updatedAt: true },
    });
    expect(after).toEqual(before);
  });
});
