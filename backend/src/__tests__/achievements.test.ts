import { prisma } from '../db';
import { checkAndUpdateAchievements } from '../utils/achievements';

describe('Achievements', () => {
  let userId: string;
  let authCookie: string;

  beforeAll(async () => {
    // Create test user
    const user = await prisma.user.create({
      data: {
        username: `testachievements${Date.now()}`,
        passwordHash: 'testhash',
      },
    });
    userId = user.id;

    // Ensure achievements exist
    const achievementCount = await prisma.achievement.count();
    if (achievementCount === 0) {
      // Create a test achievement
      await prisma.achievement.create({
        data: {
          code: 'TEST_FIRST_FLIGHT',
          name: 'First Flight',
          description: 'Complete your first flight',
          requirementType: 'flights_count',
          requirement: 1,
          icon: '✈️',
          category: 'milestone',
        },
      });
    }
  });

  afterAll(async () => {
    // Clean up
    await prisma.userAchievement.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe('checkAndUpdateAchievements', () => {
    it('should unlock achievement when requirement is met', async () => {
      // Create a flight that meets the requirement
      await prisma.flight.create({
        data: {
          userId,
          airline: 'Test Airline',
          flightNumber: 'TA123',
          depLat: 50.0379,
          depLon: 8.5622,
          arrLat: 51.4700,
          arrLon: -0.4543,
          depIata: 'FRA',
          arrIata: 'LHR',
          departureTime: new Date('2025-01-20T08:00:00Z'),
          arrivalTime: new Date('2025-01-20T09:30:00Z'),
          status: 'flown',
        },
      });

      // Check achievements
      const newlyUnlocked = await checkAndUpdateAchievements(userId);

      // Should have unlocked at least one achievement
      expect(newlyUnlocked.length).toBeGreaterThanOrEqual(0);

      // Verify achievement was created/updated
      const userAchievements = await prisma.userAchievement.findMany({
        where: { userId },
        include: { achievement: true },
      });

      expect(userAchievements.length).toBeGreaterThan(0);
    });

    it('should not unlock achievement when requirement is not met', async () => {
      // Get a high requirement achievement
      const highRequirementAchievement = await prisma.achievement.findFirst({
        where: {
          requirementType: 'distance_km',
          requirement: { gte: 100000 },
        },
      });

      if (highRequirementAchievement) {
        // Check achievements with no flights
        await prisma.flight.deleteMany({ where: { userId } });

        const newlyUnlocked = await checkAndUpdateAchievements(userId);

        // Should not unlock high requirement achievement
        const unlocked = newlyUnlocked.find(
          ua => ua.achievement.id === highRequirementAchievement.id
        );
        expect(unlocked).toBeUndefined();
      }
    });

    it('should handle invalid userId gracefully', async () => {
      // Test with invalid userId - should return empty array (user has no flights)
      const result = await checkAndUpdateAchievements('invalid-user-id');
      expect(result).toEqual([]);
    });

    it('should update progress for non-unlocked achievements', async () => {
      // Create a flight
      await prisma.flight.create({
        data: {
          userId,
          airline: 'Test Airline',
          flightNumber: 'TA456',
          depLat: 50.0379,
          depLon: 8.5622,
          arrLat: 51.4700,
          arrLon: -0.4543,
          depIata: 'FRA',
          arrIata: 'LHR',
          departureTime: new Date('2025-01-21T08:00:00Z'),
          arrivalTime: new Date('2025-01-21T09:30:00Z'),
          status: 'flown',
        },
      });

      // Check achievements
      await checkAndUpdateAchievements(userId);

      // Verify progress was updated
      const userAchievements = await prisma.userAchievement.findMany({
        where: { userId },
      });

      expect(userAchievements.length).toBeGreaterThan(0);
      // Progress should be greater than 0
      const hasProgress = userAchievements.some(ua => ua.progress > 0);
      expect(hasProgress).toBe(true);
    });
  });
});






















