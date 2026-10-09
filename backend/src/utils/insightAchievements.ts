import type { Achievement } from "../prisma";
import { now as clockNow } from "../shared/time/clock";
import { lodgingInsights, placeInsights } from "../services/stats/insights";

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
  placeRevisitGapYears: number;
  placeTripCategoriesMax: number;
  placeDocumentedVisits: number;
}

export const EMPTY_INSIGHT_STATS: InsightAchievementStats = {
  lodgingTripTypesMax: 0,
  lodgingSameHouseYears: 0,
  lodgingMonthsInYear: 0,
  placeRevisitGapYears: 0,
  placeTripCategoriesMax: 0,
  placeDocumentedVisits: 0,
};

export async function calculateInsightAchievementStats(
  userId: string,
  at: Date = clockNow()
): Promise<InsightAchievementStats> {
  const [lodging, places] = await Promise.all([
    lodgingInsights(userId, at).then((r) => r.response),
    placeInsights(userId, at).then((r) => r.response),
  ]);
  return {
    lodgingTripTypesMax: lodging.tripBases.typesPerCompletedTripMax,
    lodgingSameHouseYears: lodging.revisits.sameHouseYearsMax,
    lodgingMonthsInYear: lodging.calendar.monthsInYearMax,
    placeRevisitGapYears: places.revisits.longestGapYears,
    placeTripCategoriesMax: places.diversity.tripCategoriesMax,
    // A visit "documented" for the badge carries its OWN note and its OWN
    // photo — both are attached to the visit row itself, so the attribution
    // is explicit, never inferred from a trip's album.
    placeDocumentedVisits: places.documentation.withNoteAndPhoto,
  };
}

const MEASURE: Record<string, keyof InsightAchievementStats> = {
  lodging_trip_types_max: "lodgingTripTypesMax",
  lodging_same_house_years: "lodgingSameHouseYears",
  lodging_months_in_year: "lodgingMonthsInYear",
  place_revisit_gap_years: "placeRevisitGapYears",
  place_trip_categories_max: "placeTripCategoriesMax",
  place_documented_visits: "placeDocumentedVisits",
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
