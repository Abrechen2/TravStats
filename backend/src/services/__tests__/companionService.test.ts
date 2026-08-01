import { prisma } from '../../db';
import { resolveCompanions, linkRowsFor } from '../companionService';

describe('resolveCompanions', () => {
  let userId: string;

  beforeEach(async () => {
    await prisma.companion.deleteMany();
    await prisma.user.deleteMany();
    const user = await prisma.user.create({
      data: { username: 'companion-test', passwordHash: 'x' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.companion.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it('creates one companion for spellings that share an identity', async () => {
    const first = await resolveCompanions(userId, ['Anna Müller']);
    const second = await resolveCompanions(userId, ['  anna   müller ']);
    expect(second[0].id).toBe(first[0].id);
    expect(await prisma.companion.count({ where: { userId } })).toBe(1);
  });

  it('keeps the newest spelling as the display name', async () => {
    await resolveCompanions(userId, ['anna müller']);
    const again = await resolveCompanions(userId, ['Anna Müller']);
    expect(again[0].displayName).toBe('Anna Müller');
  });

  it('returns companions in input order', async () => {
    const result = await resolveCompanions(userId, ['Bea', 'Anna', 'Cem']);
    expect(result.map((c) => c.displayName)).toEqual(['Bea', 'Anna', 'Cem']);
  });

  // Every real caller sends a mix of known and new names. An implementation
  // that resolved existing companions in bulk and appended new ones would
  // reorder the result and still pass the all-new-names test above.
  it('keeps input order when known and new names are interleaved', async () => {
    await resolveCompanions(userId, ['Anna', 'Cem']);

    const result = await resolveCompanions(userId, ['Bea', 'Anna', 'Dora', 'Cem']);

    expect(result.map((c) => c.displayName)).toEqual(['Bea', 'Anna', 'Dora', 'Cem']);
  });

  it('drops blank entries', async () => {
    const result = await resolveCompanions(userId, ['Anna', '   ', '']);
    expect(result).toHaveLength(1);
  });

  it('does not leak companions between users', async () => {
    const other = await prisma.user.create({
      data: { username: 'companion-other', passwordHash: 'x' },
    });
    const mine = await resolveCompanions(userId, ['Anna']);
    const theirs = await resolveCompanions(other.id, ['Anna']);
    expect(theirs[0].id).not.toBe(mine[0].id);
  });
});

describe('linkRowsFor', () => {
  it('numbers positions from zero in order', () => {
    expect(linkRowsFor(['a', 'b'])).toEqual([
      { companionId: 'a', position: 0 },
      { companionId: 'b', position: 1 },
    ]);
  });
});
