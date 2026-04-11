import request from 'supertest';
import app from '../index';
import { prisma } from '../db';
import { hashPassword } from '../utils/password';
import { generateToken } from '../utils/jwt';

describe('Pending Updates API', () => {
  let authCookie: string;
  let userId: string;
  let flightId: string;
  let pendingUpdateId: string;

  beforeAll(async () => {
    // Seed the test user directly via Prisma + sign a JWT so the suite
    // doesn't depend on POST /auth/register (which is gated by
    // ALLOW_REGISTRATION in the test env).
    const username = `testpendingapi${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: await hashPassword('password123'),
      },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;

    // Create user settings
    await prisma.userSettings.create({
      data: {
        userId,
        data: {},
        autoUpdateEnabled: true,
        autoUpdateRequireApproval: true,
      },
    });

    // Create test flight
    const flight = await prisma.flight.create({
      data: {
        userId,
        airline: 'Lufthansa',
        flightNumber: 'LH123',
        depIata: 'FRA',
        depIcao: 'EDDF',
        arrIata: 'LHR',
        arrIcao: 'EGLL',
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 51.4700,
        arrLon: -0.4543,
        departureTime: new Date(),
        arrivalTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        status: 'scheduled',
      },
    });
    flightId = flight.id;

    // Create test pending update
    const pendingUpdate = await prisma.pendingFlightUpdate.create({
      data: {
        flightId,
        userId,
        status: 'pending',
        originalData: {
          arrIata: 'LHR',
        },
        proposedData: {
          arrIata: 'LGW',
        },
        changes: [
          {
            field: 'arrIata',
            oldValue: 'LHR',
            newValue: 'LGW',
            type: 'changed',
          },
        ],
        apiSource: 'airlabs',
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    pendingUpdateId = pendingUpdate.id;
  });

  afterAll(async () => {
    // Clean up
    await prisma.pendingFlightUpdate.deleteMany({ where: { userId } });
    await prisma.pendingUpdateStatistics.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe('GET /api/v1/pending-updates', () => {
    it('should return all pending updates for authenticated user', async () => {
      const response = await request(app)
        .get('/api/v1/pending-updates')
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.body).toHaveProperty('updates');
      expect(Array.isArray(response.body.updates)).toBe(true);
    });

    it('should reject unauthenticated request', async () => {
      await request(app)
        .get('/api/v1/pending-updates')
        .expect(401);
    });

    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/v1/pending-updates?status=pending')
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.body.updates.every((u: any) => u.status === 'pending')).toBe(true);
    });
  });

  describe('GET /api/v1/pending-updates/:id', () => {
    it('should return specific pending update', async () => {
      const response = await request(app)
        .get(`/api/v1/pending-updates/${pendingUpdateId}`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.body.id).toBe(pendingUpdateId);
    });

    it('should return 404 for non-existent update', async () => {
      await request(app)
        .get('/api/v1/pending-updates/non-existent-id')
        .set('Cookie', authCookie)
        .expect(404);
    });
  });

  describe('PUT /api/v1/pending-updates/:id', () => {
    it('should update pending update with edited data', async () => {
      const response = await request(app)
        .put(`/api/v1/pending-updates/${pendingUpdateId}`)
        .set('Cookie', authCookie)
        .send({
          editedData: {
            arrIata: 'STN',
          },
          editedChanges: [
            {
              field: 'arrIata',
              oldValue: 'LHR',
              newValue: 'STN',
              type: 'changed',
            },
          ],
        })
        .expect(200);

      expect(response.body.editedData).toBeDefined();
      expect(response.body.status).toBe('edited');
    });

    it('should validate edited data', async () => {
      await request(app)
        .put(`/api/v1/pending-updates/${pendingUpdateId}`)
        .set('Cookie', authCookie)
        .send({
          editedData: null, // Invalid
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/pending-updates/:id/apply', () => {
    it('should apply pending update', async () => {
      // Create a new pending update for this test
      const newPendingUpdate = await prisma.pendingFlightUpdate.create({
        data: {
          flightId,
          userId,
          status: 'pending',
          originalData: {
            arrIata: 'LHR',
          },
          proposedData: {
            arrIata: 'LGW',
          },
          changes: [
            {
              field: 'arrIata',
              oldValue: 'LHR',
              newValue: 'LGW',
              type: 'changed',
            },
          ],
          apiSource: 'airlabs',
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      const response = await request(app)
        .post(`/api/v1/pending-updates/${newPendingUpdate.id}/apply`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.flight).toBeDefined();
    });

    it('should return 404 for non-existent update', async () => {
      await request(app)
        .post('/api/v1/pending-updates/non-existent-id/apply')
        .set('Cookie', authCookie)
        .expect(404);
    });
  });

  describe('POST /api/v1/pending-updates/:id/reject', () => {
    it('should reject pending update', async () => {
      // Create a new pending update for this test
      const newPendingUpdate = await prisma.pendingFlightUpdate.create({
        data: {
          flightId,
          userId,
          status: 'pending',
          originalData: {
            arrIata: 'LHR',
          },
          proposedData: {
            arrIata: 'LGW',
          },
          changes: [
            {
              field: 'arrIata',
              oldValue: 'LHR',
              newValue: 'LGW',
              type: 'changed',
            },
          ],
          apiSource: 'airlabs',
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      const response = await request(app)
        .post(`/api/v1/pending-updates/${newPendingUpdate.id}/reject`)
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('DELETE /api/v1/pending-updates/:id', () => {
    it('should delete pending update', async () => {
      // Create a new pending update for this test
      const newPendingUpdate = await prisma.pendingFlightUpdate.create({
        data: {
          flightId,
          userId,
          status: 'pending',
          originalData: {},
          proposedData: {},
          changes: [],
          apiSource: 'airlabs',
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      await request(app)
        .delete(`/api/v1/pending-updates/${newPendingUpdate.id}`)
        .set('Cookie', authCookie)
        .expect(204);

      // Verify it's deleted
      const deleted = await prisma.pendingFlightUpdate.findUnique({
        where: { id: newPendingUpdate.id },
      });
      expect(deleted).toBeNull();
    });
  });

  describe('GET /api/v1/pending-updates/statistics', () => {
    it('should return pending update statistics', async () => {
      const response = await request(app)
        .get('/api/v1/pending-updates/statistics')
        .set('Cookie', authCookie)
        .expect(200);

      expect(response.body).toHaveProperty('totalUpdates');
      expect(response.body).toHaveProperty('appliedUpdates');
      expect(response.body).toHaveProperty('rejectedUpdates');
    });
  });
});
