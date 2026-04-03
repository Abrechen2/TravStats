import type { AchievementsResponse, LeaderboardEntry, UserAchievement } from "../../types";

import { api } from "./client";

// Achievements API
export const achievementsApi = {
  getAll: async (): Promise<AchievementsResponse> => {
    const { data } = await api.get<AchievementsResponse>("/achievements");
    return data;
  },

  getRecent: async (limit = 10): Promise<{ achievements: UserAchievement[] }> => {
    const { data } = await api.get<{ achievements: UserAchievement[] }>("/achievements/recent", {
      params: { limit },
    });
    return data;
  },

  checkAchievements: async (): Promise<{
    message: string;
    newlyUnlocked: number;
    achievements: UserAchievement[];
  }> => {
    const { data } = await api.post<{
      message: string;
      newlyUnlocked: number;
      achievements: UserAchievement[];
    }>("/achievements/check");
    return data;
  },

  getLeaderboard: async (limit = 10): Promise<{ leaderboard: LeaderboardEntry[] }> => {
    const { data } = await api.get<{ leaderboard: LeaderboardEntry[] }>(
      "/achievements/leaderboard",
      { params: { limit } }
    );
    return data;
  },
};
