import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('flight companions', () => {
  let cookie: string[];

  beforeEach(async () => {
    await prisma.flightCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.user.deleteMany();
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'flight-companions', password: 'password123' })
      .expect(201);
    cookie = registration.headers['set-cookie'];
  });

  afterAll(async () => {
    await prisma.flightCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  const newFlight = (companions: string[]) => ({
    flightNumber: 'LH400',
    departure: { iata: 'FRA', lat: 50.0379, lon: 8.5622 },
    arrival: { iata: 'JFK', lat: 40.6413, lon: -73.7781 },
    departureLocal: '2026-08-14T14:35',
    depTimezone: 'Europe/Berlin',
    arrivalLocal: '2026-08-14T16:50',
    arrTimezone: 'America/New_York',
    companions,
  });

  it('creates links and still answers with plain names', async () => {
    const created = await request(app)
      .post('/api/v1/flights')
      .set('Cookie', cookie)
      .send(newFlight(['Anna', 'Jonas']))
      .expect(201);

    expect(created.body.flight.companions).toEqual(['Anna', 'Jonas']);
    expect(await prisma.flightCompanion.count()).toBe(2);
  });

  // The rollback guarantee: the old image reads this column.
  it('keeps the legacy array in agreement with the links', async () => {
    const created = await request(app)
      .post('/api/v1/flights')
      .set('Cookie', cookie)
      .send(newFlight(['Anna', 'Jonas']))
      .expect(201);

    const row = await prisma.flight.findUniqueOrThrow({
      where: { id: created.body.flight.id },
      include: { companionLinks: { include: { companion: true }, orderBy: { position: 'asc' } } },
    });
    expect(row.companions).toEqual(['Anna', 'Jonas']);
    expect(row.companionLinks.map((l) => l.companion.displayName)).toEqual(['Anna', 'Jonas']);
  });

  it('replaces links on update rather than accumulating them', async () => {
    const created = await request(app)
      .post('/api/v1/flights')
      .set('Cookie', cookie)
      .send(newFlight(['Anna', 'Jonas']))
      .expect(201);

    await request(app)
      .put(`/api/v1/flights/${created.body.flight.id}`)
      .set('Cookie', cookie)
      .send({ companions: ['Anna'] })
      .expect(200);

    expect(
      await prisma.flightCompanion.count({ where: { flightId: created.body.flight.id } })
    ).toBe(1);
  });

  // The invariant is array-vs-links agreement; near-duplicates in ONE request
  // used to produce 2 array entries and 1 link row.
  it('keeps array and links in agreement when one request repeats a name', async () => {
    const created = await request(app)
      .post('/api/v1/flights')
      .set('Cookie', cookie)
      .send(newFlight(['Anna', 'anna']))
      .expect(201);

    const row = await prisma.flight.findUniqueOrThrow({
      where: { id: created.body.flight.id },
      include: { companionLinks: true },
    });
    expect(row.companions).toHaveLength(row.companionLinks.length);
    expect(row.companionLinks).toHaveLength(1);
  });

  it('clears links when an update sends an empty list', async () => {
    const created = await request(app)
      .post('/api/v1/flights')
      .set('Cookie', cookie)
      .send(newFlight(['Anna', 'Jonas']))
      .expect(201);

    await request(app)
      .put(`/api/v1/flights/${created.body.flight.id}`)
      .set('Cookie', cookie)
      .send({ companions: [] })
      .expect(200);

    const row = await prisma.flight.findUniqueOrThrow({
      where: { id: created.body.flight.id },
      include: { companionLinks: true },
    });
    expect(row.companions).toEqual([]);
    expect(row.companionLinks).toEqual([]);
  });
});
