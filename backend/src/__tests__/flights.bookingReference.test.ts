import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

/**
 * forgejo#119, measured on the beta on 2026-09-11: POST /flights?merge=true
 * deduplicated on normalised flight number + UTC day only. The booking
 * reference was stored and never consulted, so an updated confirmation for a
 * rebooking landed as a SECOND flight — and the Companion posts every
 * document-parsed flight through exactly this path.
 *
 * The cases below are the ones from that measurement, plus the one it could
 * not have found: a through ticket, whose legs share one reference and must
 * NOT be folded together.
 */
describe('POST /flights — the booking reference as a match key', () => {
  let cookie: string[];

  beforeEach(async () => {
    await prisma.flightCompanion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.user.deleteMany();
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'pnr-dedupe', password: 'password123' })
      .expect(201);
    cookie = registration.headers['set-cookie'];
  });

  afterAll(async () => {
    await prisma.flightCompanion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  const booking = (overrides: Record<string, unknown> = {}) => ({
    flightNumber: 'LH9931',
    bookingReference: 'ZZMESS',
    departure: { iata: 'MUC', lat: 48.3537, lon: 11.775 },
    arrival: { iata: 'FRA', lat: 50.0379, lon: 8.5622 },
    departureLocal: '2027-03-10T12:00',
    depTimezone: 'Europe/Berlin',
    arrivalLocal: '2027-03-10T13:00',
    arrTimezone: 'Europe/Berlin',
    ...overrides,
  });

  const post = (body: Record<string, unknown>) =>
    request(app).post('/api/v1/flights?merge=true').set('Cookie', cookie).send(body);

  it('reports no change when the same confirmation arrives twice', async () => {
    await post(booking()).expect(201);
    const second = await post(booking()).expect(200);

    expect(second.body.mergedFields).toEqual([]);
    expect(await prisma.flight.count()).toBe(1);
  });

  it('moves the flight instead of creating a second one when it is rebooked to another day', async () => {
    await post(booking()).expect(201);

    const rebooked = await post(
      booking({ departureLocal: '2027-03-11T12:00', arrivalLocal: '2027-03-11T13:00' })
    ).expect(200);

    expect(rebooked.body.mergedFields).toEqual(expect.arrayContaining(['departureTime']));
    expect(await prisma.flight.count()).toBe(1);

    const row = await prisma.flight.findFirstOrThrow();
    expect(row.departureTime?.toISOString()).toBe('2027-03-11T11:00:00.000Z');
  });

  it('moves the flight number when the booking is reissued under a new one', async () => {
    await post(booking()).expect(201);

    const reissued = await post(booking({ flightNumber: 'LH9933' })).expect(200);

    expect(reissued.body.mergedFields).toContain('flightNumber');
    expect(await prisma.flight.count()).toBe(1);

    const row = await prisma.flight.findFirstOrThrow();
    expect(row.flightNumber).toBe('LH9933');
  });

  it('keeps the legs of a through ticket apart, though they share the reference', async () => {
    await post(booking()).expect(201);

    // Same PNR, the onward leg. Only the route tells this apart from a
    // rebooking of the first one.
    await post(
      booking({
        flightNumber: 'LH0400',
        departure: { iata: 'FRA', lat: 50.0379, lon: 8.5622 },
        arrival: { iata: 'JFK', lat: 40.6413, lon: -73.7781 },
        departureLocal: '2027-03-10T15:00',
        arrivalLocal: '2027-03-10T18:00',
        arrTimezone: 'America/New_York',
      })
    ).expect(201);

    expect(await prisma.flight.count()).toBe(2);
  });

  it('answers 409 for a booking match when the caller did not ask to merge', async () => {
    await post(booking()).expect(201);

    const refused = await request(app)
      .post('/api/v1/flights')
      .set('Cookie', cookie)
      .send(booking({ departureLocal: '2027-03-11T12:00', arrivalLocal: '2027-03-11T13:00' }))
      .expect(409);

    expect(refused.body.error).toBe('DUPLICATE_FLIGHT');
    expect(await prisma.flight.count()).toBe(1);
  });
});
