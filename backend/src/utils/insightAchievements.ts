import type { Achievement } from "../prisma";
import { now as clockNow } from "../shared/time/clock";
import { lodgingInsights } from "../services/stats/insights";

/**
 * The Part K badges (forgejo#258/#259/#260/#264) — their measures and their
 * check. Every measure is read off the insight builders the statistics tab
 * draws from, so a badge and its figure are one computation. A module of its
 * own because `achievementChecks.ts` is frozen at its size by the ratchet and
 * `achievements.ts` loads only what the older measures need.
 */
export interface InsightAchievementStats {
  lodgingTripTypesMax: number;
  lodgingSameHouseYears: number;
  lodgingMonthsInYear: number;
}

export const EMPTY_INSIGHT_STATS: InsightAchievementStats = {
  lodgingTripTypesMax: 0,
  lodgingSameHouseYears: 0,
  lodgingMonthsInYear: 0,
};

export async function calculateInsightAchievementStats(
  userId: string,
  at: Date = clockNow()
): Promise<InsightAchievementStats> {
  const lodging = (await lodgingInsights(userId, at)).response;
  return {
    lodgingTripTypesMax: lodging.tripBases.typesPerCompletedTripMax,
    lodgingSameHouseYears: lodging.revisits.sameHouseYearsMax,
    lodgingMonthsInYear: lodging.calendar.monthsInYearMax,
  };
}

const MEASURE: Record<string, keyof InsightAchievementStats> = {
  lodging_trip_types_max: "lodgingTripTypesMax",
  lodging_same_house_years: "lodgingSameHouseYears",
  lodging_months_in_year: "lodgingMonthsInYear",
};

/** The badge's progress, or `null` when it is not a Part K badge. */
export function checkInsightAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: InsightAchievementStats
): { isUnlocked: boolean; progress: number } | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  const progress = Math.floor(stats[key]);
  return { isUnlocked: progress >= achievement.requirement, progress };
}
