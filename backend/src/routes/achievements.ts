import { Router, Response, NextFunction } from "express";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { statsLimiter } from "../middleware/rateLimit";
import { checkAndUpdateAchievements } from "../utils/achievements";
import { resolveRank } from "../utils/achievementRank";
import { isAchievementHeld } from "../utils/achievementHeld";
import { achievements as catalogueDefinitions } from "../data/achievements";

const router = Router();

// Internal scaffolding seeded by regression tests
// (`achievements.scheduledLeak.test.ts`) uses this prefix. These rows
// are not user-facing — filter them out of every list endpoint.
const TEST_ACHIEVEMENT_PREFIX = "TEST_";

// A definition removed from the seeds stays in older databases on purpose
// (ensureAchievements never deletes), so an unlock already earned survives —
// FOUR_SEASONS_YEAR is one. Counting such a row in the total made an older
// instance read "83 of 276" against a 275-entry catalogue, a badge nobody can
// earn any more. The fraction counts live definitions; a legacy unlock stays
// listed and keeps its points.
const LIVE_ACHIEVEMENT_CODES = new Set(catalogueDefinitions.map((a) => a.code));

// All routes require authentication; PATs need write scope to mutate
// (POST /check recomputes + persists user achievement state).
router.use(authenticate);
router.use(requireWriteScope);

// Get all achievements with user progress
router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    // Get all achievements
    const achievements = await prisma.achievement.findMany({
      where: {
        code: { not: { startsWith: TEST_ACHIEVEMENT_PREFIX } },
      },
      orderBy: [{ category: "asc" }, { tier: "asc" }, { requirement: "asc" }],
    });

    // Get user's unlocked achievements
    const userAchievements = await prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
    });

    // Create a map for quick lookup
    const userAchievementMap = new Map(userAchievements.map((ua) => [ua.achievementId, ua]));

    const isLive = (code: string) => LIVE_ACHIEVEMENT_CODES.has(code);
    const liveAchievements = achievements.filter((a) => isLive(a.code));

    // Combine data — an orphaned row is shown only to a user who unlocked it
    const achievementsWithProgress = achievements
      .filter((achievement) => {
        if (isLive(achievement.code)) return true;
        const ua = userAchievementMap.get(achievement.id);
        return isAchievementHeld(ua, achievement.requirement);
      })
      .map((achievement) => {
        const userAchievement = userAchievementMap.get(achievement.id);
        const progress = userAchievement?.progress || 0;
        const isUnlocked = isAchievementHeld(userAchievement, achievement.requirement);

        return {
          ...achievement,
          // A retired definition is on the list only because it was earned; the
          // flag lets a client keep it out of "x of y" the way `summary` does.
          isRetired: !isLive(achievement.code),
          isUnlocked,
          // Sent whether or not the badge is held right now. It is the first
          // time the requirement was met and is never cleared (owner's ruling,
          // 2026-09-20), so a card that has dropped back to a progress bar can
          // say "Zuletzt erreicht am …" rather than let a number fall with no
          // explanation. Suppressing it here — which this line did, while
          // held-ness and the date were the same question — leaves the page
          // nothing to show.
          unlockedAt: userAchievement?.unlockedAt ?? null,
          progress,
          progressPercentage: Math.min(100, Math.round((progress / achievement.requirement) * 100)),
        };
      });

    // Calculate totals only for unlocked achievements
    const unlocked = userAchievements.filter((ua) =>
      isAchievementHeld(ua, ua.achievement.requirement)
    );

    const totalPoints = unlocked.reduce((sum, ua) => sum + ua.achievement.points, 0);
    const unlockedLive = unlocked.filter((ua) => isLive(ua.achievement.code));

    // Calculate achievements by category
    const categories = liveAchievements.reduce(
      (acc, ach) => {
        if (!acc[ach.category]) {
          acc[ach.category] = { total: 0, unlocked: 0 };
        }
        acc[ach.category].total++;
        if (achievementsWithProgress.find((a) => a.id === ach.id)?.isUnlocked) {
          acc[ach.category].unlocked++;
        }
        return acc;
      },
      {} as Record<string, { total: number; unlocked: number }>
    );

    // Rank rides on unlocked points only — see utils/achievementRank.ts. The
    // `rank` value is a stable slug, not display copy: clients localize it.
    const { rank, nextRankPoints } = resolveRank(totalPoints);

    res.json({
      achievements: achievementsWithProgress,
      summary: {
        totalAchievements: liveAchievements.length,
        unlockedAchievements: unlockedLive.length,
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
router.get("/recent", async (req: AuthRequest, res: Response, next: NextFunction) => {
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
      // `unlockedAt` is null for a badge the user does not hold, and NULLS FIRST
      // is Postgres' default for DESC — which would put every un-earned row at
      // the head of the list the filter below then throws away. Ordering them
      // last keeps the "recent" order recent.
      orderBy: { unlockedAt: { sort: "desc", nulls: "last" } },
    });

    // Only badges the user actually holds — `isAchievementHeld` is the one home
    // for that question, and since the owner's ruling of 2026-09-20 it reads
    // the live measure. A badge whose measure has dipped below its requirement
    // leaves this list; its `unlockedAt` stays in the database, and it comes
    // back here at that original date if the measure recovers.
    const recentAchievements = allRecent
      .filter((ua) => isAchievementHeld(ua, ua.achievement.requirement))
      .slice(0, limit);

    res.json({ achievements: recentAchievements });
  } catch (error) {
    next(error);
  }
});

// Manually trigger achievement check (useful for testing or background jobs)
//
// Rate-limited on `statsLimiter`: this re-derives every achievement from the
// caller's whole logbook and writes the progress rows back, which is the same
// full-history aggregation the stats endpoints do — plus the writes. The list
// routes above only read the already-computed rows and stay unlimited.
router.post("/check", statsLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    const newlyUnlocked = await checkAndUpdateAchievements(userId);

    res.json({
      message: "Achievement check completed",
      newlyUnlocked: newlyUnlocked.length,
      achievements: newlyUnlocked,
    });
  } catch (error) {
    next(error);
  }
});

// Get leaderboard (top users by points)
//
// The one route in this app whose cost is set by the size of the INSTANCE
// rather than by the caller's own data: it loads every UserAchievement row of
// every user with their achievement and user joined, then aggregates in JS.
// There is no WHERE on the caller and no pagination, so on a family instance
// it grows with everyone's progress at once. Same `statsLimiter` bucket —
// 30/min is plenty for a board nobody watches change second by second.
router.get(
  "/leaderboard",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
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
          // The only column held-ness reads (utils/achievementHeld.ts). This
          // `select` also carried `unlockedAt` for the day the date conferred
          // the badge; the owner's ruling of 2026-09-20 took that back, and a
          // column nothing reads is one more thing to keep in step.
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

      // Only count badges the user actually holds — same rule as the two lists
      // above, read off the live measure, so the board and the user's own page
      // can never disagree about what they are counting.
      const userPointsMap = new Map<
        string,
        {
          user: { id: string; username: string; createdAt: Date };
          totalPoints: number;
          achievementCount: number;
        }
      >();

      for (const ua of userAchievements) {
        if (!isAchievementHeld(ua, ua.achievement.requirement)) continue;

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
  }
);

export default router;
