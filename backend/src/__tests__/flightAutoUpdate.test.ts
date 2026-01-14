import { prisma } from '../db';
import { isFlightActive, calculateChanges, checkAndUpdateFlights } from '../services/flightAutoUpdate';
import { Flight } from '@prisma/client';

describe('Flight Auto-Update Service', () => {
  let userId: string;
  let testFlight: Flight;

  beforeAll(async () => {
    // Create test user
    const user = await prisma.user.create({
      data: {
        username: `testautoupdate${Date.now()}`,
        passwordHash: 'testhash',
      },
    });
    userId = user.id;

    // Create user settings with auto-update enabled
    await prisma.userSettings.create({
      data: {
        userId: user.id,
        autoUpdateEnabled: true,
        autoUpdateRequireApproval: true,
        autoUpdateCheckInterval: 15,
        autoUpdateOnlyDuringFlight: true,
        autoUpdateExpiryHours: 24,
      },
    });

    // Create test flight
    const now = new Date();
    const departureTime = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
    const arrivalTime = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now

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
        departureTime,
        arrivalTime,
        status: 'scheduled',
      },
    });
  });

  afterAll(async () => {
    // Clean up
    await prisma.pendingFlightUpdate.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe('isFlightActive', () => {
    it('should return true for active flight', () => {
      const now = new Date();
      const departureTime = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago
      const arrivalTime = new Date(now.getTime() + 1 * 60 * 60 * 1000); // 1 hour from now

      const flight: Flight = {
        ...testFlight,
        departureTime,
        arrivalTime,
        status: 'scheduled',
      };

      expect(isFlightActive(flight)).toBe(true);
    });

    it('should return false for future flight', () => {
      const now = new Date();
      const departureTime = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now
      const arrivalTime = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours from now

      const flight: Flight = {
        ...testFlight,
        departureTime,
        arrivalTime,
        status: 'scheduled',
      };

      expect(isFlightActive(flight)).toBe(false);
    });

    it('should return false for old flight (beyond buffer)', () => {
      const now = new Date();
      const departureTime = new Date(now.getTime() - 5 * 60 * 60 * 1000); // 5 hours ago
      const arrivalTime = new Date(now.getTime() - 3 * 60 * 60 * 1000); // 3 hours ago

      const flight: Flight = {
        ...testFlight,
        departureTime,
        arrivalTime,
        status: 'flown',
      };

      expect(isFlightActive(flight)).toBe(false);
    });

    it('should return true for recently completed flight (within buffer)', () => {
      const now = new Date();
      const departureTime = new Date(now.getTime() - 3 * 60 * 60 * 1000); // 3 hours ago
      const arrivalTime = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago

      const flight: Flight = {
        ...testFlight,
        departureTime,
        arrivalTime,
        status: 'flown',
      };

      expect(isFlightActive(flight)).toBe(true);
    });
  });

  describe('calculateChanges', () => {
    it('should detect changed fields', () => {
      const originalData = {
        airline: 'Lufthansa',
        depIata: 'FRA',
        arrIata: 'LHR',
        departureTime: '2025-01-20T08:00:00Z',
        arrivalTime: '2025-01-20T09:30:00Z',
      };

      const proposedData = {
        airline: 'Lufthansa',
        depIata: 'FRA',
        arrIata: 'LGW', // Changed
        departureTime: '2025-01-20T08:15:00Z', // Changed
        arrivalTime: '2025-01-20T09:30:00Z',
      };

      const changes = calculateChanges(originalData, proposedData);

      expect(changes).toHaveLength(2);
      expect(changes.find(c => c.field === 'arrIata')).toBeDefined();
      expect(changes.find(c => c.field === 'departureTime')).toBeDefined();
    });

    it('should detect added fields', () => {
      const originalData = {
        airline: 'Lufthansa',
        depIata: 'FRA',
      };

      const proposedData = {
        airline: 'Lufthansa',
        depIata: 'FRA',
        flightNumber: 'LH123', // Added
      };

      const changes = calculateChanges(originalData, proposedData);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe('added');
      expect(changes[0].field).toBe('flightNumber');
    });

    it('should detect removed fields', () => {
      const originalData = {
        airline: 'Lufthansa',
        depIata: 'FRA',
        flightNumber: 'LH123',
      };

      const proposedData = {
        airline: 'Lufthansa',
        depIata: 'FRA',
      };

      const changes = calculateChanges(originalData, proposedData);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe('removed');
      expect(changes[0].field).toBe('flightNumber');
    });

    it('should ignore insignificant time changes', () => {
      const originalData = {
        departureTime: '2025-01-20T08:00:00Z',
      };

      const proposedData = {
        departureTime: '2025-01-20T08:02:00Z', // Only 2 minutes difference
      };

      const changes = calculateChanges(originalData, proposedData);

      // Should be filtered out due to TIME_CHANGE_THRESHOLD_MINUTES = 5
      expect(changes).toHaveLength(0);
    });

    it('should include significant time changes', () => {
      const originalData = {
        departureTime: '2025-01-20T08:00:00Z',
      };

      const proposedData = {
        departureTime: '2025-01-20T08:10:00Z', // 10 minutes difference
      };

      const changes = calculateChanges(originalData, proposedData);

      expect(changes).toHaveLength(1);
      expect(changes[0].field).toBe('departureTime');
    });
  });

  describe('checkAndUpdateFlights', () => {
    it('should not create update for inactive flight when onlyDuringFlight is true', async () => {
      // Create a future flight
      const futureFlight = await prisma.flight.create({
        data: {
          userId,
          airline: 'Lufthansa',
          flightNumber: 'LH456',
          depIata: 'FRA',
          depIcao: 'EDDF',
          arrIata: 'LHR',
          arrIcao: 'EGLL',
          depLat: 50.0379,
          depLon: 8.5622,
          arrLat: 51.4700,
          arrLon: -0.4543,
          departureTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
          arrivalTime: new Date(Date.now() + 26 * 60 * 60 * 1000),
          status: 'scheduled',
        },
      });

      await checkAndUpdateFlights(userId, {
        checkInterval: 15,
        onlyDuringFlight: true,
        requireApproval: true,
        expiryHours: 24,
      });

      const updates = await prisma.pendingFlightUpdate.findMany({
        where: { flightId: futureFlight.id },
      });

      expect(updates).toHaveLength(0);

      // Cleanup
      await prisma.flight.delete({ where: { id: futureFlight.id } });
    });
  });
});




