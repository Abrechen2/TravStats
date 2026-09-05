/**
 * Achievement types. Moved out of `index.ts` on 2026-09-05 when the file
 * crossed its frozen size; `index.ts` re-exports them, so every import site
 * still reads `from "../types"`.
 */

export interface Achievement {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  tier: "bronze" | "silver" | "gold" | "platinum" | "diamond";
  requirement: number;
  requirementType: string;
  points: number;
  isHidden: boolean;
  createdAt: string;
  isUnlocked?: boolean;
  unlockedAt?: string | null;
  progress?: number;
  progressPercentage?: number;
  // Domain the achievement belongs to. `shared` means "always show regardless of
  // which domains the user enabled". `string` fallback keeps us forward-compatible
  // with future domains the backend might introduce before the frontend learns them.
  domain: "flight" | "cruise" | "shared" | string;
}

export interface AchievementSummary {
  totalAchievements: number;
  unlockedAchievements: number;
  totalPoints: number;
  categories: Record<string, { total: number; unlocked: number }>;
}

export interface AchievementsResponse {
  achievements: Achievement[];
  summary: AchievementSummary;
}

export interface UserAchievement {
  id: string;
  userId: string;
  achievementId: string;
  unlockedAt: string;
  progress: number;
  achievement: Achievement;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  totalPoints: number;
  achievementCount: number;
}
