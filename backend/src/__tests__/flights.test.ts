import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('Flights API', () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    // Create test user and get auth cookie
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        username: 'flighttest',
        password: 'password123',
      });

    // Extract cookie from set-cookie header
    authCookie = response.headers['set-cookie'][0];
    userId = response.body.user.id;
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
          departureTime: '2025-01-20T08:00:00Z',
          arrivalTime: '2025-01-20T09:30:00Z',
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
});
