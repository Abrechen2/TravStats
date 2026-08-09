import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('cruise companions', () => {
  let cookie: string[];

  beforeEach(async () => {
    await prisma.cruiseCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.cruise.deleteMany();
    await prisma.user.deleteMany();
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'cruise-companions', password: 'password123' })
      .expect(201);
    cookie = registration.headers['set-cookie'];
  });

  afterAll(async () => {
    await prisma.cruiseCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.cruise.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  // Minimal valid payload: no stops at all satisfies the 3-state stop
  // invariant trivially (an empty/omitted stops array has no stop to
  // violate it), so this doesn't need port/ship fixtures.
  const newCruise = (companions: string[]) => ({
    cruiseLine: 'AIDA',
    startDate: '2026-08-14T00:00:00.000Z',
    endDate: '2026-08-21T00:00:00.000Z',
    companions,
  });

  it('creates links and still answers with plain names', async () => {
    const created = await request(app)
      .post('/api/v1/cruises')
      .set('Cookie', cookie)
      .send(newCruise(['Anna', 'Jonas']))
      .expect(201);

    expect(created.body.data.companions).toEqual(['Anna', 'Jonas']);

    // This is the assertion that would NOT catch the spread trap on its
    // own — the response already looks correct even when no links were
    // ever written. The DB-level count below is what actually proves it.
    expect(await prisma.cruiseCompanion.count()).toBe(2);

    const row = await prisma.cruise.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: { companionLinks: { include: { companion: true }, orderBy: { position: 'asc' } } },
    });
    expect(row.companions).toEqual(['Anna', 'Jonas']);
    expect(row.companionLinks.map((l) => l.companion.displayName)).toEqual(['Anna', 'Jonas']);
  });

  // The invariant is array-vs-links agreement; near-duplicates in ONE
  // request used to (in the trip write path, before it was fixed) produce
  // 2 array entries and 1 link row — must not regress here either.
  it('keeps array and links in agreement when one request repeats an identity', async () => {
    const created = await request(app)
      .post('/api/v1/cruises')
      .set('Cookie', cookie)
      .send(newCruise(['Anna', 'anna']))
      .expect(201);

    expect(created.body.data.companions).toHaveLength(1);

    const row = await prisma.cruise.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: { companionLinks: true },
    });
    expect(row.companions).toHaveLength(row.companionLinks.length);
    expect(row.companionLinks).toHaveLength(1);
  });

  it('replaces links on update rather than accumulating them', async () => {
    const created = await request(app)
      .post('/api/v1/cruises')
      .set('Cookie', cookie)
      .send(newCruise(['Anna', 'Jonas']))
      .expect(201);

    const updated = await request(app)
      .patch(`/api/v1/cruises/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ companions: ['Anna'] })
      .expect(200);

    expect(updated.body.data.companions).toEqual(['Anna']);
    expect(
      await prisma.cruiseCompanion.count({ where: { cruiseId: created.body.data.id } }),
    ).toBe(1);
  });

  it('clears links when an update sends an empty list', async () => {
    const created = await request(app)
      .post('/api/v1/cruises')
      .set('Cookie', cookie)
      .send(newCruise(['Anna', 'Jonas']))
      .expect(201);

    const updated = await request(app)
      .patch(`/api/v1/cruises/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ companions: [] })
      .expect(200);

    expect(updated.body.data.companions).toEqual([]);

    const row = await prisma.cruise.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: { companionLinks: true },
    });
    expect(row.companions).toEqual([]);
    expect(row.companionLinks).toEqual([]);
  });
});
