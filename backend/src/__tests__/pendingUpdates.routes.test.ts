import request from 'supertest';
import app from '../index';
import { prisma } from '../db';

describe('Pending Updates API', () => {
  let authCookie: string;
  let userId: string;
  let flightId: string;
  let pendingUpdateId: string;

  beforeAll(async () => {
    // Create test user and get auth cookie
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        username: `testpendingapi${Date.now()}`,
        password: 'password123',
      });

    authCookie = response.headers['set-cookie'][0];
    userId = response.body.user.id;

    // Create user settings
    await prisma.userSettings.create({
      data: {
        userId,
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

      expect(response.body).toHaveProperty('update');
      expect(response.body.update.id).toBe(pendingUpdateId);
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

      expect(response.body).toHaveProperty('update');
      expect(response.body.update.editedData).toBeDefined();
      expect(response.body.update.status).toBe('pending');
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

      expect(response.body).toHaveProperty('update');
      expect(response.body.update.status).toBe('applied');
      expect(response.body.update.appliedAt).toBeDefined();
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

      expect(response.body).toHaveProperty('update');
      expect(response.body.update.status).toBe('rejected');
      expect(response.body.update.rejectedAt).toBeDefined();
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

      expect(response.body).toHaveProperty('statistics');
      expect(response.body.statistics).toHaveProperty('totalUpdates');
      expect(response.body.statistics).toHaveProperty('appliedUpdates');
      expect(response.body.statistics).toHaveProperty('rejectedUpdates');
    });
  });
});

