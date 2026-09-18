/**
 * Evidence measures — Achievements page. Every measure here is
 * `servedIn: 2`, per the owner's decision of 2026-09-18: release 1 serves
 * only the Statistics page's `metric`/`ranking` kinds, and everything on
 * this page waits for release 2 regardless of aggregation — which is why a
 * `sum` count sits at `servedIn: 2` here while an equally-`sum` count on the
 * Statistics page is `servedIn: 1` in the sibling files.
 *
 * MIRRORED at `backend/src/shared/evidenceMeasuresAchievements.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const ACHIEVEMENTS_CALCULATOR =
  "GET /achievements (utils/achievementWrites.ts, utils/achievementChecks.ts)";
const LEADERBOARD_CALCULATOR = "GET /achievements/leaderboard (routes/achievements.ts)";

export const ACHIEVEMENT_MEASURES: Record<string, MeasureSpec> = {
  achievementUnlockedCount: {
    aggregation: "sum",
    unit: "achievements",
    // `visibleAchievements = filterAchievementsByDomain(achievements, enabled)`
    // in AchievementsPage.tsx — the same population crossDomain* measures
    // are scoped over, not the account's whole catalogue.
    scopes: ["domainFiltered"],
    surface: "AchievementsPage (header meta)",
    // Same function call, same destructured object as
    // `achievementRetiredUnlockedCount` below — both come out of ONE
    // `countAchievements(visibleAchievements)`, so both are attributed
    // to it rather than one of them pointing at the write path instead.
    calculator: "lib/achievementCounts.ts countAchievements (client fold over GET /achievements)",
    servedIn: 2,
  },
  achievementTotalPoints: {
    aggregation: "sum",
    unit: "points",
    // Unlike the four `domainFiltered` measures below, this reads
    // `summary?.totalPoints` from the server's `AchievementSummary`
    // directly — never filtered by `visibleAchievements` — so it stays
    // allTime.
    scopes: ["allTime"],
    surface: "AchievementsPage (header meta)",
    calculator: ACHIEVEMENTS_CALCULATOR,
    servedIn: 2,
  },
  achievementRetiredUnlockedCount: {
    aggregation: "sum",
    unit: "achievements",
    scopes: ["domainFiltered"],
    surface: "AchievementsPage (header meta)",
    calculator: "lib/achievementCounts.ts countAchievements (client fold over GET /achievements)",
    servedIn: 2,
  },
  achievementTierProgress: {
    aggregation: "sum",
    unit: "achievements",
    scopes: ["domainFiltered"],
    surface: "AchievementsPage (tier strip)",
    calculator: "AchievementsPage.tsx countBy (client fold over GET /achievements)",
    servedIn: 2,
  },
  achievementCategoryCount: {
    aggregation: "sum",
    unit: "achievements",
    scopes: ["domainFiltered"],
    surface: "AchievementsPage (category pills)",
    calculator: "AchievementsPage.tsx countBy (client fold over GET /achievements)",
    servedIn: 2,
  },
  achievementProgressRatio: {
    aggregation: "ratio",
    unit: "%",
    scopes: ["allTime"],
    surface: "AchievementCard",
    calculator:
      "utils/achievementChecks.ts checkAchievement (progress/requirement written at check time)",
    servedIn: 2,
  },
  leaderboardAchievementCount: {
    aggregation: "sum",
    unit: "achievements",
    scopes: ["allTime"],
    surface: "AchievementLeaderboard",
    calculator: LEADERBOARD_CALCULATOR,
    servedIn: 2,
  },
  leaderboardTotalPoints: {
    aggregation: "sum",
    unit: "points",
    scopes: ["allTime"],
    surface: "AchievementLeaderboard",
    calculator: LEADERBOARD_CALCULATOR,
    servedIn: 2,
  },
};
