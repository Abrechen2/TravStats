import { Router, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { checkAndUpdateAchievements } from '../utils/achievements';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get all achievements with user progress
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    // Get all achievements
    const achievements = await prisma.achievement.findMany({
      orderBy: [
        { category: 'asc' },
        { tier: 'asc' },
        { requirement: 'asc' },
      ],
    });

    // Get user's unlocked achievements
    const userAchievements = await prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
    });

    // Create a map for quick lookup
    const userAchievementMap = new Map(
      userAchievements.map(ua => [ua.achievementId, ua])
    );

    // Combine data
    const achievementsWithProgress = achievements.map(achievement => {
      const userAchievement = userAchievementMap.get(achievement.id);

      return {
        ...achievement,
        isUnlocked: !!userAchievement,
        unlockedAt: userAchievement?.unlockedAt || null,
        progress: userAchievement?.progress || 0,
        progressPercentage: Math.min(
          100,
          Math.round((userAchievement?.progress || 0) / achievement.requirement * 100)
        ),
      };
    });

    // Calculate total points
    const totalPoints = userAchievements.reduce(
      (sum, ua) => sum + ua.achievement.points,
      0
    );

    // Calculate achievements by category
    const categories = achievements.reduce((acc, ach) => {
      if (!acc[ach.category]) {
        acc[ach.category] = { total: 0, unlocked: 0 };
      }
      acc[ach.category].total++;
      if (userAchievementMap.has(ach.id)) {
        acc[ach.category].unlocked++;
      }
      return acc;
    }, {} as Record<string, { total: number; unlocked: number }>);

    res.json({
      achievements: achievementsWithProgress,
      summary: {
        totalAchievements: achievements.length,
        unlockedAchievements: userAchievements.length,
        totalPoints,
        categories,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get recently unlocked achievements
router.get('/recent', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const limit = parseInt(req.query.limit as string) || 10;

    const recentAchievements = await prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
      orderBy: { unlockedAt: 'desc' },
      take: limit,
    });

    res.json({ achievements: recentAchievements });
  } catch (error) {
    next(error);
  }
});

// Manually trigger achievement check (useful for testing or background jobs)
router.post('/check', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    const newlyUnlocked = await checkAndUpdateAchievements(userId);

    res.json({
      message: 'Achievement check completed',
      newlyUnlocked: newlyUnlocked.length,
      achievements: newlyUnlocked,
    });
  } catch (error) {
    next(error);
  }
});

// Get leaderboard (top users by points)
router.get('/leaderboard', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    // Get all user achievements with their points
    const userAchievements = await prisma.userAchievement.findMany({
      include: {
        user: { select: { id: true, username: true, createdAt: true } },
        achievement: { select: { points: true } },
      },
    });

    // Calculate total points per user
    const userPointsMap = userAchievements.reduce((acc, ua) => {
      const userId = ua.user.id;
      if (!acc[userId]) {
        acc[userId] = {
          user: ua.user,
          totalPoints: 0,
          achievementCount: 0,
        };
      }
      acc[userId].totalPoints += ua.achievement.points;
      acc[userId].achievementCount++;
      return acc;
    }, {} as Record<string, any>);

    // Convert to array and sort
    const leaderboard = Object.values(userPointsMap)
      .sort((a: any, b: any) => b.totalPoints - a.totalPoints)
      .slice(0, limit)
      .map((entry: any, index: number) => ({
        rank: index + 1,
        username: entry.user.username,
        totalPoints: entry.totalPoints,
        achievementCount: entry.achievementCount,
      }));

    res.json({ leaderboard });
  } catch (error) {
    next(error);
  }
});

export default router;
