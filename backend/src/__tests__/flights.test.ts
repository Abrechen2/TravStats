import request from 'supertest';
import app from '../index';
import { prisma } from '../db';
import { hashPassword } from '../utils/password';
import { generateToken } from '../utils/jwt';

describe('Flights API', () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    // Seed the test user directly via Prisma + sign a JWT so the suite
    // doesn't depend on POST /auth/register (which is gated by
    // ALLOW_REGISTRATION in the test env).
    await prisma.flight.deleteMany({ where: { user: { username: 'flighttest' } } });
    await prisma.user.deleteMany({ where: { username: 'flighttest' } });

    const user = await prisma.user.create({
      data: {
        username: 'flighttest',
        passwordHash: await hashPassword('password123'),
      },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    // Clean up
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe('POST /api/v1/flights', () => {
    it('should create a flight', async () => {
      const response = await request(app)
        .post('/api/v1/flights')
        .set('Cookie', authCookie)
        .send({
          airline: 'Lufthansa',
          flightNumber: 'LH123',
          departure: {
            icao: 'EDDF',
            iata: 'FRA',
            lat: 50.0379,
            lon: 8.5622,
          },
          arrival: {
            icao: 'EGLL',
            iata: 'LHR',
            lat: 51.4700,
            lon: -0.4543,
          },
          departureLocal: '2025-01-20T08:00',
          depTimezone: 'Europe/Berlin',
          arrivalLocal: '2025-01-20T09:30',
          arrTimezone: 'Europe/London',
          status: 'scheduled',
        })
        .expect(201);

      expect(response.body).toHaveProperty('flight');
      expect(response.body.flight).toHaveProperty('id');
      expect(response.body.flight.airline).toBe('Lufthansa');
    });

    it('should reject unauthenticated request', async () => {
      await request(app)
        .post('/api/v1/flights')
        .send({
          airline: 'Test',
          flightNumber: 'T123',
        })
        .expect(401);
    });
  });

  describe('GET /api/v1/flights', () => {
    it('should get user flights', async () => {
      const response = await request(app)
        .get('/api/v1/flights')
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.body).toHaveProperty('flights');
      expect(Array.isArray(response.body.flights)).toBe(true);
    });
  });

  describe('GET /api/v1/flights/geo', () => {
    it('should get flights as GeoJSON', async () => {
      const response = await request(app)
        .get('/api/v1/flights/geo')
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.body.type).toBe('FeatureCollection');
      expect(Array.isArray(response.body.features)).toBe(true);
    });
  });

  describe('PUT /api/v1/flights/:id boarding-pass field passthrough', () => {
    // Regression test for the silent-drop bug shipped in 1.4.0-rc.1: the PUT
    // handler had an explicit field whitelist that omitted bookingReference
    // and 10 other boarding-pass / email-import fields, so a client that
    // PATCHed any of them got a 200-OK with no DB change.
    it('persists every boarding-pass field a PUT carries', async () => {
      const created = await request(app)
        .post('/api/v1/flights')
        .set('Cookie', authCookie)
        .send({
          airline: 'Lufthansa',
          flightNumber: 'LH456',
          departure: { icao: 'EDDM', iata: 'MUC', lat: 48.3537, lon: 11.7750 },
          arrival: { icao: 'LIRF', iata: 'FCO', lat: 41.8003, lon: 12.2389 },
          departureLocal: '2025-02-15T10:00',
          depTimezone: 'Europe/Berlin',
          arrivalLocal: '2025-02-15T11:45',
          arrTimezone: 'Europe/Rome',
          status: 'scheduled',
        })
        .expect(201);

      const flightId = created.body.flight.id;

      const updated = await request(app)
        .put(`/api/v1/flights/${flightId}`)
        .set('Cookie', authCookie)
        .send({
          seatNumber: '14A',
          boardingGroup: '2',
          gate: 'B12',
          terminal: '2',
          bookingReference: 'PNR123',
          ticketNumber: '220-2451234567',
          baggageAllowance: '1x23kg',
          frequentFlyerNumber: 'M&M-ABCDE',
          bookingClassLetter: 'Y',
          coPassengers: ['Alice Smith', 'Bob Jones'],
          dataSource: 'boarding_pass_scan',
        })
        .expect(200);

      const f = updated.body.flight;
      expect(f.seatNumber).toBe('14A');
      expect(f.boardingGroup).toBe('2');
      expect(f.gate).toBe('B12');
      expect(f.terminal).toBe('2');
      expect(f.bookingReference).toBe('PNR123');
      expect(f.ticketNumber).toBe('220-2451234567');
      expect(f.baggageAllowance).toBe('1x23kg');
      expect(f.frequentFlyerNumber).toBe('M&M-ABCDE');
      expect(f.bookingClassLetter).toBe('Y');
      expect(f.coPassengers).toEqual(['Alice Smith', 'Bob Jones']);
      expect(f.dataSource).toBe('boarding_pass_scan');
    });

    it('honors an explicit depTimeSemantics override even when departureLocal is also sent', async () => {
      const created = await request(app)
        .post('/api/v1/flights')
        .set('Cookie', authCookie)
        .send({
          airline: 'Test',
          flightNumber: 'T1',
          departure: { iata: 'FRA', lat: 50.0379, lon: 8.5622 },
          arrival: { iata: 'JFK', lat: 40.6413, lon: -73.7781 },
          departureLocal: '2025-03-01T12:00',
          depTimezone: 'Europe/Berlin',
          arrivalLocal: '2025-03-01T15:00',
          arrTimezone: 'America/New_York',
          status: 'scheduled',
        })
        .expect(201);

      const flightId = created.body.flight.id;

      const updated = await request(app)
        .put(`/api/v1/flights/${flightId}`)
        .set('Cookie', authCookie)
        .send({
          departureLocal: '2025-03-01T12:00',
          depTimezone: 'Europe/Berlin',
          depTimeSemantics: 'DATE_ONLY',
        })
        .expect(200);

      // Without the explicit-override fix the implicit branch would clobber
      // this back to 'UTC' because departureLocal was supplied alongside.
      expect(updated.body.flight.depTimeSemantics).toBe('DATE_ONLY');
    });
  });
});
