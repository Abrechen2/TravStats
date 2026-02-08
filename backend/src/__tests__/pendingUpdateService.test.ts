import { prisma } from '../db';
import {
  getPendingUpdates,
  applyPendingUpdate,
  rejectPendingUpdate,
  updatePendingUpdate,
  getPendingUpdateById,
  calculateStatisticsImpact,
  cleanupExpiredUpdates,
} from '../services/pendingUpdateService';
import { Flight } from '@prisma/client';

describe('Pending Update Service', () => {
  let userId: string;
  let testFlight: Flight;
  let pendingUpdateId: string;

  beforeAll(async () => {
    // Create test user
    const user = await prisma.user.create({
      data: {
        username: `testpending${Date.now()}`,
        passwordHash: 'testhash',
      },
    });
    userId = user.id;

    // Create test flight
    const now = new Date();
    testFlight = await prisma.flight.create({
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
        departureTime: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        arrivalTime: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        status: 'scheduled',
      },
    });

    // Create test pending update
    const pendingUpdate = await prisma.pendingFlightUpdate.create({
      data: {
        flightId: testFlight.id,
        userId,
        status: 'pending',
        originalData: {
          airline: 'Lufthansa',
          depIata: 'FRA',
          arrIata: 'LHR',
        },
        proposedData: {
          airline: 'Lufthansa',
          depIata: 'FRA',
          arrIata: 'LGW', // Changed
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
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe('getPendingUpdates', () => {
    it('should return all pending updates for user', async () => {
      const updates = await getPendingUpdates(userId);

      expect(updates).toBeDefined();
      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0].userId).toBe(userId);
    });

    it('should filter by status', async () => {
      const updates = await getPendingUpdates(userId, { status: 'pending' });

      expect(updates.every(u => u.status === 'pending')).toBe(true);
    });

    it('should filter by flightId', async () => {
      const updates = await getPendingUpdates(userId, { flightId: testFlight.id });

      expect(updates.every(u => u.flightId === testFlight.id)).toBe(true);
    });
  });

  describe('getPendingUpdateById', () => {
    it('should return pending update by id', async () => {
      const update = await getPendingUpdateById(pendingUpdateId, userId);

      expect(update).toBeDefined();
      expect(update?.id).toBe(pendingUpdateId);
    });

    it('should return null for non-existent update', async () => {
      const update = await getPendingUpdateById('non-existent-id', userId);

      expect(update).toBeNull();
    });

    it('should return null for update belonging to different user', async () => {
      // Create another user
      const otherUser = await prisma.user.create({
        data: {
          username: `testother${Date.now()}`,
          passwordHash: 'testhash',
        },
      });

      const update = await getPendingUpdateById(pendingUpdateId, otherUser.id);

      expect(update).toBeNull();

      // Cleanup
      await prisma.user.delete({ where: { id: otherUser.id } });
    });
  });

  describe('updatePendingUpdate', () => {
    it('should update pending update with edited data', async () => {
      const editedData = {
        airline: 'Lufthansa',
        depIata: 'FRA',
        arrIata: 'STN', // Different from proposed
      };

      const editedChanges = [
        {
          field: 'arrIata',
          oldValue: 'LHR',
          newValue: 'STN',
          type: 'changed',
        },
      ];

      const updated = await updatePendingUpdate(
        pendingUpdateId,
        userId,
        editedData
      );

      expect(updated).toBeDefined();
      expect(updated.status).toBe('pending');
      expect(updated.editedData).toBeDefined();
      expect(updated.editedChanges).toBeDefined();
      expect(updated.editedAt).toBeDefined();
    });
  });

  describe('applyPendingUpdate', () => {
    it('should apply pending update to flight', async () => {
      // Create a new pending update for this test
      const newPendingUpdate = await prisma.pendingFlightUpdate.create({
        data: {
          flightId: testFlight.id,
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

      const applied = await applyPendingUpdate(newPendingUpdate.id, userId);

      expect(applied).toBeDefined();
      expect(applied.status).toBe('applied');
      expect(applied.appliedAt).toBeDefined();

      // Verify flight was updated
      const updatedFlight = await prisma.flight.findUnique({
        where: { id: testFlight.id },
      });

      expect(updatedFlight?.arrIata).toBe('LGW');
    });
  });

  describe('rejectPendingUpdate', () => {
    it('should reject pending update', async () => {
      // Create a new pending update for this test
      const newPendingUpdate = await prisma.pendingFlightUpdate.create({
        data: {
          flightId: testFlight.id,
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

      const rejected = await rejectPendingUpdate(newPendingUpdate.id, userId);

      expect(rejected).toBeDefined();
      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectedAt).toBeDefined();
    });
  });

  describe('calculateStatisticsImpact', () => {
    it('should calculate statistics impact correctly', async () => {
      // Create additional flights for better statistics
      await prisma.flight.create({
        data: {
          userId,
          airline: 'British Airways',
          flightNumber: 'BA456',
          depIata: 'LHR',
          depIcao: 'EGLL',
          arrIata: 'JFK',
          arrIcao: 'KJFK',
          depLat: 51.4700,
          depLon: -0.4543,
          arrLat: 40.6413,
          arrLon: -73.7781,
          departureTime: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          arrivalTime: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
          status: 'flown',
        },
      });

      const proposedData = {
        arrIata: 'LGW',
        arrIcao: 'EGKK',
        arrLat: 51.1537,
        arrLon: -0.1821,
      };

      const impact = await calculateStatisticsImpact(
        testFlight.id,
        userId,
        proposedData,
        testFlight as any
      );

      expect(impact).toBeDefined();
      expect(impact.distance).toBeDefined();
      expect(impact.flightTime).toBeDefined();
      expect(impact.airlines).toBeDefined();
      expect(impact.airports).toBeDefined();
    });
  });

  describe('cleanupExpiredUpdates', () => {
    it('should mark expired updates as expired', async () => {
      // Create an expired pending update
      const expiredUpdate = await prisma.pendingFlightUpdate.create({
        data: {
          flightId: testFlight.id,
          userId,
          status: 'pending',
          originalData: {},
          proposedData: {},
          changes: [],
          apiSource: 'airlabs',
          fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 2 days ago
          expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago (expired)
        },
      });

      await cleanupExpiredUpdates();

      const updated = await prisma.pendingFlightUpdate.findUnique({
        where: { id: expiredUpdate.id },
      });

      expect(updated?.status).toBe('expired');
    });
  });
});




