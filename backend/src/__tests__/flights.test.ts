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

    // The create handler fed seatClass to the CO2 calculator but never wrote
    // the column, so a first-class flight stored first-class emissions against
    // a blank cabin. Only the update path persisted it.
    it('persists the seat class it was given, not just its CO2 weight', async () => {
      const response = await request(app)
        .post('/api/v1/flights')
        .set('Cookie', authCookie)
        .send({
          airline: 'Lufthansa',
          flightNumber: 'LH777',
          departure: { icao: 'EDDF', iata: 'FRA', lat: 50.0379, lon: 8.5622 },
          arrival: { icao: 'KJFK', iata: 'JFK', lat: 40.6413, lon: -73.7781 },
          departureLocal: '2025-03-01T10:00',
          depTimezone: 'Europe/Berlin',
          arrivalLocal: '2025-03-01T13:00',
          arrTimezone: 'America/New_York',
          seatClass: 'first',
          status: 'scheduled',
        })
        .expect(201);

      expect(response.body.flight.seatClass).toBe('first');

      // GET /:id answers with the flight unwrapped, not under a `flight` key.
      const reloaded = await request(app)
        .get(`/api/v1/flights/${response.body.flight.id}`)
        .set('Cookie', authCookie)
        .expect(200);
      expect(reloaded.body.seatClass).toBe('first');
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

    it('caps result count at 500 by default', async () => {
      const response = await request(app)
        .get('/api/v1/flights?limit=1000')
        .set('Cookie', authCookie)
        .expect(200);

      // limit in the response body is the applied cap, not the requested one
      expect(response.body.limit).toBeLessThanOrEqual(500);
      expect(response.body.all).toBe(false);
    });

    it('?all=true bypasses the 500-row cap and returns the full set', async () => {
      const response = await request(app)
        .get('/api/v1/flights?all=true')
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.body.all).toBe(true);
      // limit echoes total when all=true so consumers know what they got
      expect(response.body.limit).toBe(response.body.total);
      expect(response.body.flights.length).toBe(response.body.total);
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

  describe('PUT /api/v1/flights/:id clearing optional classifications', () => {
    // The edit form offers "(optional)" for category and seat class. Clearing
    // must be expressible on the wire: null clears, undefined leaves alone.
    // Before category became nullable, the frontend could only OMIT the field,
    // which the handler reads as "don't change" — the UI showed the value
    // removed while the DB kept it.
    it('clears category and seatClass with an explicit null, and recomputes CO2', async () => {
      const created = await request(app)
        .post('/api/v1/flights')
        .set('Cookie', authCookie)
        .send({
          airline: 'Lufthansa',
          flightNumber: 'LH789',
          departure: { icao: 'EDDF', iata: 'FRA', lat: 50.0379, lon: 8.5622 },
          arrival: { icao: 'KJFK', iata: 'JFK', lat: 40.6413, lon: -73.7781 },
          departureLocal: '2025-04-01T10:00',
          depTimezone: 'Europe/Berlin',
          arrivalLocal: '2025-04-01T13:30',
          arrTimezone: 'America/New_York',
          status: 'scheduled',
          category: 'business',
          seatClass: 'first',
        })
        .expect(201);

      const flightId = created.body.flight.id;
      const co2WithFirst = created.body.flight.co2Kg;

      const cleared = await request(app)
        .put(`/api/v1/flights/${flightId}`)
        .set('Cookie', authCookie)
        .send({ category: null, seatClass: null })
        .expect(200);

      expect(cleared.body.flight.category).toBeNull();
      expect(cleared.body.flight.seatClass).toBeNull();
      // CO2 must recompute with the default multiplier, not resurrect 'first'.
      expect(cleared.body.flight.co2Kg).toBeLessThan(co2WithFirst);

      // And an update that OMITS both fields must leave the nulls alone.
      const untouched = await request(app)
        .put(`/api/v1/flights/${flightId}`)
        .set('Cookie', authCookie)
        .send({ notes: 'unrelated edit' })
        .expect(200);

      expect(untouched.body.flight.category).toBeNull();
      expect(untouched.body.flight.seatClass).toBeNull();
    });

    // The whole clear-family: every optional text/number field the edit
    // modal renders must be clearable with an explicit null. Before the
    // schema turned nullable, the frontend could only omit a blanked field
    // and the PUT silently kept the old value.
    it('clears every optional detail field with an explicit null, cascading airline codes', async () => {
      const created = await request(app)
        .post('/api/v1/flights')
        .set('Cookie', authCookie)
        .send({
          airline: 'Lufthansa',
          airlineIata: 'LH',
          airlineIcao: 'DLH',
          operatingAirline: 'Eurowings',
          flightNumber: 'LH900',
          aircraft: 'A320',
          departure: { icao: 'EDDF', iata: 'FRA', lat: 50.0379, lon: 8.5622 },
          arrival: { icao: 'EGLL', iata: 'LHR', lat: 51.47, lon: -0.4543 },
          departureLocal: '2025-05-01T10:00',
          depTimezone: 'Europe/Berlin',
          arrivalLocal: '2025-05-01T11:00',
          arrTimezone: 'Europe/London',
          status: 'scheduled',
          seatNumber: '1A',
          boardingGroup: '1',
          gate: 'A1',
          terminal: '1',
          bookingReference: 'REF1',
          ticketNumber: 'TKT1',
          baggageAllowance: '23kg',
          frequentFlyerNumber: 'FF1',
          bookingClassLetter: 'Y',
          notes: 'note',
          price: 100,
          taxes: 10,
          fees: 5,
        })
        .expect(201);

      const flightId = created.body.flight.id;

      const cleared = await request(app)
        .put(`/api/v1/flights/${flightId}`)
        .set('Cookie', authCookie)
        .send({
          airline: null,
          operatingAirline: null,
          flightNumber: null,
          aircraft: null,
          seatNumber: null,
          boardingGroup: null,
          gate: null,
          terminal: null,
          bookingReference: null,
          ticketNumber: null,
          baggageAllowance: null,
          frequentFlyerNumber: null,
          bookingClassLetter: null,
          notes: null,
          price: null,
          taxes: null,
          fees: null,
        })
        .expect(200);

      const f = cleared.body.flight;
      for (const field of [
        'airline',
        'operatingAirline',
        'flightNumber',
        'aircraft',
        'seatNumber',
        'boardingGroup',
        'gate',
        'terminal',
        'bookingReference',
        'ticketNumber',
        'baggageAllowance',
        'frequentFlyerNumber',
        'bookingClassLetter',
        'notes',
        'price',
        'taxes',
        'fees',
      ]) {
        expect(f[field]).toBeNull();
      }
      // Clearing the airline must not leave its resolved codes behind —
      // logos and stats key off them.
      expect(f.airlineIata).toBeNull();
      expect(f.airlineIcao).toBeNull();
    });

    it('clears a recorded actual departure/arrival with null, and resets the delay', async () => {
      const created = await request(app)
        .post('/api/v1/flights')
        .set('Cookie', authCookie)
        .send({
          airline: 'Lufthansa',
          flightNumber: 'LH901',
          departure: { icao: 'EDDF', iata: 'FRA', lat: 50.0379, lon: 8.5622 },
          arrival: { icao: 'EGLL', iata: 'LHR', lat: 51.47, lon: -0.4543 },
          departureLocal: '2025-05-02T10:00',
          depTimezone: 'Europe/Berlin',
          arrivalLocal: '2025-05-02T11:00',
          arrTimezone: 'Europe/London',
          status: 'flown',
          actualDepartureLocal: '2025-05-02T10:25',
          actualDepartureTz: 'Europe/Berlin',
          actualArrivalLocal: '2025-05-02T11:20',
          actualArrivalTz: 'Europe/London',
        })
        .expect(201);

      expect(created.body.flight.actualDeparture).not.toBeNull();
      expect(created.body.flight.delayMinutes).toBe(25);

      const cleared = await request(app)
        .put(`/api/v1/flights/${created.body.flight.id}`)
        .set('Cookie', authCookie)
        .send({ actualDepartureLocal: null, actualArrivalLocal: null })
        .expect(200);

      expect(cleared.body.flight.actualDeparture).toBeNull();
      expect(cleared.body.flight.actualArrival).toBeNull();
      expect(cleared.body.flight.delayMinutes).toBeNull();
    });

    // The category column used to carry @default("private"): a POST that
    // omitted the field silently classified the flight as private while the
    // UI's own default suggested business — two systems, two opinions. With
    // the default dropped (migration 20260802063748), omitted means NULL.
    it('stores NULL for a created flight that omits category', async () => {
      const created = await request(app)
        .post('/api/v1/flights')
        .set('Cookie', authCookie)
        .send({
          airline: 'Lufthansa',
          flightNumber: 'LH790',
          departure: { icao: 'EDDF', iata: 'FRA', lat: 50.0379, lon: 8.5622 },
          arrival: { icao: 'EGLL', iata: 'LHR', lat: 51.47, lon: -0.4543 },
          departureLocal: '2025-04-02T10:00',
          depTimezone: 'Europe/Berlin',
          arrivalLocal: '2025-04-02T11:00',
          arrTimezone: 'Europe/London',
          status: 'scheduled',
        })
        .expect(201);

      expect(created.body.flight.category).toBeNull();
    });
  });
});
