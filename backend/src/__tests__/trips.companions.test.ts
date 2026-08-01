import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('trip companions', () => {
  let cookie: string[];

  beforeEach(async () => {
    await prisma.tripCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'trip-companions', password: 'password123' })
      .expect(201);
    cookie = registration.headers['set-cookie'];
  });

  afterAll(async () => {
    await prisma.tripCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  const newTrip = (companions: string[]) => ({
    name: 'Sommerreise',
    startDate: '2026-08-14',
    endDate: '2026-08-28',
    companions,
  });

  it('creates links and still answers with plain names', async () => {
    const created = await request(app)
      .post('/api/v1/trips')
      .set('Cookie', cookie)
      .send(newTrip(['Anna', 'Jonas']))
      .expect(201);

    expect(created.body.trip.companions).toEqual(['Anna', 'Jonas']);
    expect(await prisma.tripCompanion.count()).toBe(2);
  });

  it('keeps the legacy array in agreement with the links', async () => {
    const created = await request(app)
      .post('/api/v1/trips')
      .set('Cookie', cookie)
      .send(newTrip(['Anna', 'Jonas']))
      .expect(201);

    const row = await prisma.trip.findUniqueOrThrow({
      where: { id: created.body.trip.id },
      include: { companionLinks: { include: { companion: true }, orderBy: { position: 'asc' } } },
    });
    expect(row.companions).toEqual(['Anna', 'Jonas']);
    expect(row.companionLinks.map((l) => l.companion.displayName)).toEqual(['Anna', 'Jonas']);
  });

  it('replaces links on update rather than accumulating them', async () => {
    const created = await request(app)
      .post('/api/v1/trips')
      .set('Cookie', cookie)
      .send(newTrip(['Anna', 'Jonas']))
      .expect(201);

    await request(app)
      .patch(`/api/v1/trips/${created.body.trip.id}`)
      .set('Cookie', cookie)
      .send({ companions: ['Anna'] })
      .expect(200);

    expect(
      await prisma.tripCompanion.count({ where: { tripId: created.body.trip.id } })
    ).toBe(1);
  });

  // The invariant is array-vs-links agreement; near-duplicates in ONE request
  // used to produce 2 array entries and 1 link row.
  it('keeps array and links in agreement when one request repeats a name', async () => {
    const created = await request(app)
      .post('/api/v1/trips')
      .set('Cookie', cookie)
      .send(newTrip(['Anna', 'anna']))
      .expect(201);

    const row = await prisma.trip.findUniqueOrThrow({
      where: { id: created.body.trip.id },
      include: { companionLinks: true },
    });
    expect(row.companions).toHaveLength(row.companionLinks.length);
    expect(row.companionLinks).toHaveLength(1);
  });

  it('clears links when an update sends an empty list', async () => {
    const created = await request(app)
      .post('/api/v1/trips')
      .set('Cookie', cookie)
      .send(newTrip(['Anna', 'Jonas']))
      .expect(201);

    await request(app)
      .patch(`/api/v1/trips/${created.body.trip.id}`)
      .set('Cookie', cookie)
      .send({ companions: [] })
      .expect(200);

    const row = await prisma.trip.findUniqueOrThrow({
      where: { id: created.body.trip.id },
      include: { companionLinks: true },
    });
    expect(row.companions).toEqual([]);
    expect(row.companionLinks).toEqual([]);
  });
});
