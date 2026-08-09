import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('batch import companions', () => {
  let cookie: string[];

  beforeEach(async () => {
    await prisma.flightCompanion.deleteMany();
    await prisma.companion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.user.deleteMany();
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'batch-companions', password: 'password123' })
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

  const makeFlight = (overrides: Record<string, unknown>): Record<string, unknown> => ({
    flightNumber: 'LH400',
    departure: { iata: 'FRA', lat: 50.0379, lon: 8.5622 },
    arrival: { iata: 'JFK', lat: 40.6413, lon: -73.7781 },
    departureLocal: '2026-08-14T14:35',
    depTimezone: 'Europe/Berlin',
    arrivalLocal: '2026-08-14T16:50',
    arrTimezone: 'America/New_York',
    ...overrides,
  });

  // Excel re-import is the reason the contract stays string-based; two rows
  // naming the same person must not create two companions.
  it('reuses one companion across imported rows', async () => {
    await request(app)
      .post('/api/v1/flights/batch')
      .set('Cookie', cookie)
      .send([
        makeFlight({ flightNumber: 'LH400', companions: ['Anna'] }),
        makeFlight({
          flightNumber: 'LH401',
          departure: { iata: 'JFK', lat: 40.6413, lon: -73.7781 },
          arrival: { iata: 'FRA', lat: 50.0379, lon: 8.5622 },
          departureLocal: '2026-08-20T18:00',
          depTimezone: 'America/New_York',
          arrivalLocal: '2026-08-21T07:30',
          arrTimezone: 'Europe/Berlin',
          companions: ['anna'],
        }),
      ])
      .expect(201);

    expect(await prisma.companion.count()).toBe(1);
    expect(await prisma.flightCompanion.count()).toBe(2);
  });

  // The brief only asserts totals, which would not catch a row whose legacy
  // array and companionLinks disagree (e.g. 2 names in the array but only 1
  // link row for that specific flight) as long as the SUMS still line up
  // across the whole batch. Assert the per-row invariant directly.
  it('keeps each created flight’s legacy companions array in agreement with its links', async () => {
    const res = await request(app)
      .post('/api/v1/flights/batch')
      .set('Cookie', cookie)
      .send([
        makeFlight({ flightNumber: 'LH402', companions: ['Anna', 'Jonas'] }),
        makeFlight({
          flightNumber: 'LH403',
          departure: { iata: 'JFK', lat: 40.6413, lon: -73.7781 },
          arrival: { iata: 'FRA', lat: 50.0379, lon: 8.5622 },
          departureLocal: '2026-09-01T18:00',
          depTimezone: 'America/New_York',
          arrivalLocal: '2026-09-02T07:30',
          arrTimezone: 'Europe/Berlin',
          companions: ['Mia'],
        }),
      ])
      .expect(201);

    const createdIds = (res.body.flights as Array<{ id: string }>).map((f) => f.id);
    expect(createdIds).toHaveLength(2);

    for (const id of createdIds) {
      const row = await prisma.flight.findUniqueOrThrow({
        where: { id },
        include: { companionLinks: true },
      });
      expect(row.companions).toHaveLength(row.companionLinks.length);
    }
  });

  // The two tests above never exercise a row whose OWN companions list
  // collapses under resolution — every name in every row is a distinct
  // identity, so the array and the links agree in length no matter whether
  // the array is written from resolved display names or from raw input.
  // A row that repeats one identity within itself (`['Anna', 'anna']`) is
  // the one case where writing the array from raw input (2 entries) would
  // diverge from the resolved links (1 row, since resolveCompanions dedupes
  // by id) — that is exactly the deviation from the brief this test guards.
  it('keeps array and links in agreement when one row repeats a name', async () => {
    const res = await request(app)
      .post('/api/v1/flights/batch')
      .set('Cookie', cookie)
      .send([makeFlight({ flightNumber: 'LH404', companions: ['Anna', 'anna'] })])
      .expect(201);

    const createdId = (res.body.flights as Array<{ id: string }>)[0]!.id;
    const row = await prisma.flight.findUniqueOrThrow({
      where: { id: createdId },
      include: { companionLinks: true },
    });
    expect(row.companions).toHaveLength(row.companionLinks.length);
    expect(row.companionLinks).toHaveLength(1);
  });
});
