import request from 'supertest';
import app from '../../index';
import { prisma } from '../../db';
import { hashPassword } from '../../utils/password';
import { generateToken } from '../../utils/jwt';

/**
 * A field the API accepts is a field the API stores.
 *
 * Seven of them were neither: `runwayDepartureTime`, `runwayArrivalTime`,
 * `isCargo`, `aerodataboxLastUpdatedUtc`, `aerodataboxQualityTags`,
 * `baggageBelt` and `checkInDesk` passed Zod, had columns waiting for them, and
 * were left out of both the create and the update mapping. A POST carrying them
 * answered 201 and stored nulls, so an importer lost the data while being told
 * it had succeeded (audit finding AUD-020). A test that checks status codes and
 * schema validation cannot see that; only reading the row back can.
 *
 * The second case is the delay, which is a difference between two times and was
 * only ever recomputed when one of them moved (AUD-021).
 */
const USERNAME = `flight-field-roundtrip-${Date.now()}`;

// One flight per case: the API refuses a duplicate (same number, same day) with
// 409, and three identical creates would make this file fail for a reason that
// has nothing to do with what it is testing.
let flightSeq = 0;
const baseFlight = () => {
  flightSeq += 1;
  return {
    flightNumber: `LH40${flightSeq}`,
    departure: { iata: 'FRA', lat: 50.0379, lon: 8.5622 },
    arrival: { iata: 'JFK', lat: 40.6413, lon: -73.7781 },
    departureLocal: '2026-08-14T10:00',
    depTimezone: 'Europe/Berlin',
    arrivalLocal: '2026-08-14T16:50',
    arrTimezone: 'America/New_York',
  };
};

describe('flight fields survive the API', () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword('password123') },
    });
    userId = user.id;
    token = generateToken(userId);
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('stores the extended fields it accepts on create', async () => {
    const res = await request(app)
      .post('/api/v1/flights')
      .set('Cookie', [`auth_token=${token}`])
      .send({
        ...baseFlight(),
        isCargo: true,
        baggageBelt: '7',
        checkInDesk: '212-240',
        aerodataboxQualityTags: ['Departure', 'Arrival'],
        runwayDepartureTime: '2026-08-14T10:12:00.000Z',
        runwayArrivalTime: '2026-08-14T16:41:00.000Z',
        aerodataboxLastUpdatedUtc: '2026-08-14T09:00:00.000Z',
      });
    expect(res.status).toBe(201);

    const row = await prisma.flight.findUniqueOrThrow({ where: { id: res.body.flight.id } });
    expect(row.isCargo).toBe(true);
    expect(row.baggageBelt).toBe('7');
    expect(row.checkInDesk).toBe('212-240');
    expect(row.aerodataboxQualityTags).toEqual(['Departure', 'Arrival']);
    expect(row.runwayDepartureTime?.toISOString()).toBe('2026-08-14T10:12:00.000Z');
    expect(row.runwayArrivalTime?.toISOString()).toBe('2026-08-14T16:41:00.000Z');
    expect(row.aerodataboxLastUpdatedUtc?.toISOString()).toBe('2026-08-14T09:00:00.000Z');
  });

  it('stores them on update too', async () => {
    const created = await request(app)
      .post('/api/v1/flights')
      .set('Cookie', [`auth_token=${token}`])
      .send(baseFlight());
    expect(created.status).toBe(201);

    const res = await request(app)
      .put(`/api/v1/flights/${created.body.flight.id}`)
      .set('Cookie', [`auth_token=${token}`])
      .send({ baggageBelt: '3', isCargo: false, checkInDesk: 'A1' });
    expect(res.status).toBe(200);

    const row = await prisma.flight.findUniqueOrThrow({ where: { id: created.body.flight.id } });
    expect(row.baggageBelt).toBe('3');
    expect(row.checkInDesk).toBe('A1');
    expect(row.isCargo).toBe(false);
  });

  // AUD-021: correcting the plan has to correct the delay derived from it.
  it('recomputes the delay when the scheduled departure is corrected', async () => {
    const created = await request(app)
      .post('/api/v1/flights')
      .set('Cookie', [`auth_token=${token}`])
      .send({ ...baseFlight(), actualDepartureLocal: '2026-08-14T10:15' });
    expect(created.status).toBe(201);

    const first = await prisma.flight.findUniqueOrThrow({ where: { id: created.body.flight.id } });
    expect(first.delayMinutes).toBe(15);

    // Only the PLAN moves — the aircraft still left at 10:15.
    const res = await request(app)
      .put(`/api/v1/flights/${created.body.flight.id}`)
      .set('Cookie', [`auth_token=${token}`])
      .send({ departureLocal: '2026-08-14T10:10', depTimezone: 'Europe/Berlin' });
    expect(res.status).toBe(200);

    const row = await prisma.flight.findUniqueOrThrow({ where: { id: created.body.flight.id } });
    expect(row.delayMinutes).toBe(5);
  });
});
