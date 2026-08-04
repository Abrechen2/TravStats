import { Router, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { authenticate, requireWriteScope, AuthRequest } from '../middleware/auth';
import { checkAndUpdateAchievements } from '../utils/achievements';
import { resolveRank } from '../utils/achievementRank';

const router = Router();

// Internal scaffolding seeded by regression tests
// (`achievements.scheduledLeak.test.ts`) uses this prefix. These rows
// are not user-facing — filter them out of every list endpoint.
const TEST_ACHIEVEMENT_PREFIX = "TEST_";

// All routes require authentication; PATs need write scope to mutate
// (POST /check recomputes + persists user achievement state).
router.use(authenticate);
router.use(requireWriteScope);

// Get all achievements with user progress
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    // Get all achievements
    const achievements = await prisma.achievement.findMany({
      where: {
        code: { not: { startsWith: TEST_ACHIEVEMENT_PREFIX } },
      },
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
      const progress = userAchievement?.progress || 0;
      const isUnlocked = !!userAchievement && progress >= achievement.requirement;

      return {
        ...achievement,
        isUnlocked,
        unlockedAt: isUnlocked ? userAchievement?.unlockedAt || null : null,
        progress,
        progressPercentage: Math.min(
          100,
          Math.round(progress / achievement.requirement * 100)
        ),
      };
    });

    // Calculate totals only for unlocked achievements
    const unlocked = userAchievements.filter(
      ua => ua.progress >= ua.achievement.requirement
    );

    const totalPoints = unlocked.reduce((sum, ua) => sum + ua.achievement.points, 0);

    // Calculate achievements by category
    const categories = achievements.reduce((acc, ach) => {
      if (!acc[ach.category]) {
        acc[ach.category] = { total: 0, unlocked: 0 };
      }
        acc[ach.category].total++;
      if (achievementsWithProgress.find(a => a.id === ach.id)?.isUnlocked) {
        acc[ach.category].unlocked++;
      }
      return acc;
    }, {} as Record<string, { total: number; unlocked: number }>);

    // Rank rides on unlocked points only — see utils/achievementRank.ts. The
    // `rank` value is a stable slug, not display copy: clients localize it.
    const { rank, nextRankPoints } = resolveRank(totalPoints);

    res.json({
      achievements: achievementsWithProgress,
      summary: {
        totalAchievements: achievements.length,
        unlockedAchievements: unlocked.length,
        totalPoints,
        categories,
        rank,
        nextRankPoints,
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
    const rawLimit = parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(rawLimit, 100) : 10;

    const allRecent = await prisma.userAchievement.findMany({
      where: {
        userId,
        achievement: {
          code: { not: { startsWith: TEST_ACHIEVEMENT_PREFIX } },
        },
      },
      include: { achievement: true },
      orderBy: { unlockedAt: 'desc' },
    });

    // Only return actually unlocked achievements (progress >= requirement)
    const recentAchievements = allRecent
      .filter(ua => ua.progress >= ua.achievement.requirement)
      .slice(0, limit);

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
    const rawLeaderboardLimit = parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(rawLeaderboardLimit) ? Math.min(rawLeaderboardLimit, 100) : 10;

    // Get user achievements with points and requirement for unlock check
    const userAchievements = await prisma.userAchievement.findMany({
      where: {
        achievement: {
          code: { not: { startsWith: TEST_ACHIEVEMENT_PREFIX } },
        },
      },
      select: {
        userId: true,
        progress: true,
        achievement: {
          select: {
            points: true,
            requirement: true,
          },
        },
        user: {
          select: {
            id: true,
            username: true,
            createdAt: true,
          },
        },
      },
    });

    // Only count actually unlocked achievements (progress >= requirement)
    const userPointsMap = new Map<string, { user: { id: string; username: string; createdAt: Date }; totalPoints: number; achievementCount: number }>();

    for (const ua of userAchievements) {
      if (ua.progress < ua.achievement.requirement) continue;

      const userId = ua.userId;
      if (!userPointsMap.has(userId)) {
        userPointsMap.set(userId, {
          user: ua.user,
          totalPoints: 0,
          achievementCount: 0,
        });
      }
      const entry = userPointsMap.get(userId)!;
      entry.totalPoints += ua.achievement.points;
      entry.achievementCount++;
    }

    // Convert to array, sort, and limit
    const leaderboard = Array.from(userPointsMap.values())
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, limit)
      .map((entry, index) => ({
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
