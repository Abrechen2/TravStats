import type { Achievement } from "../prisma";
import { now as clockNow } from "../shared/time/clock";
import {
  loadTourFacts,
  lodgingInsights,
  placeInsights,
  tourInsights,
} from "../services/stats/insights";
import logger from "./logger";
import {
  calculateRoadtripAchievementStats,
  type RoadtripAchievementStats,
} from "./roadtripAchievements";

/**
 * The Part K badges (forgejo#258/#259/#260/#264) — their measures and their
 * check. Every measure is read off the insight builders the statistics tab
 * draws from, so a badge and its figure are one computation. A module of its
 * own because `achievementChecks.ts` is frozen at its size by the ratchet and
 * `achievements.ts` loads only what the older measures need.
 */
export interface InsightAchievementStats {
  lodgingTripTypesMax: number | null;
  lodgingSameHouseYears: number | null;
  lodgingMonthsInYear: number | null;
  placeRevisitGapYears: number | null;
  placeTripCategoriesMax: number | null;
  placeDocumentedVisits: number | null;
  tourCount: number | null;
  tourActivitiesUnique: number | null;
  tourAscentM: number | null;
}

export const EMPTY_INSIGHT_STATS: InsightAchievementStats = {
  lodgingTripTypesMax: 0,
  lodgingSameHouseYears: 0,
  lodgingMonthsInYear: 0,
  placeRevisitGapYears: 0,
  placeTripCategoriesMax: 0,
  placeDocumentedVisits: 0,
  tourCount: 0,
  tourActivitiesUnique: 0,
  tourAscentM: 0,
};

/**
 * Runs one source and keeps the check alive when it fails: the error is
 * logged and the source's badges are skipped for this run (their stored rows
 * stay as they are), rather than one bad row in a rarely used domain stopping
 * every badge update for the user (review I4).
 */
async function settle<T>(
  userId: string,
  source: string,
  work: () => Promise<T>
): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    logger.error({
      operation: "insight_badge_source_failed",
      message: "A statistics source failed during the badge check; its badges were skipped",
      context: { userId, source },
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return null;
  }
}

/**
 * Every Part K measure plus the roadtrip ones, each source read ONCE: the
 * tours are loaded a single time (without elevation profiles, which no badge
 * reads) and handed to both the roadtrip and the tour builder.
 */
export async function calculateInsightBadgeStats(
  userId: string,
  at: Date = clockNow()
): Promise<{
  roadtripStats: RoadtripAchievementStats | null;
  insightStats: InsightAchievementStats;
}> {
  const tours = await settle(userId, "tours", () =>
    loadTourFacts(userId, at, { withElevation: false })
  );
  const [roadtripStats, lodging, places, tourView] = await Promise.all([
    tours === null
      ? null
      : settle(userId, "roadtrips", () => calculateRoadtripAchievementStats(userId, at, tours)),
    settle(userId, "lodging", () => lodgingInsights(userId, at).then((r) => r.response)),
    settle(userId, "places", () => placeInsights(userId, at).then((r) => r.response)),
    tours === null
      ? null
      : settle(userId, "tourInsights", () =>
          tourInsights(userId, at, { tours }).then((r) => r.response)
        ),
  ]);
  return {
    roadtripStats,
    insightStats: {
      lodgingTripTypesMax: lodging?.tripBases.typesPerCompletedTripMax ?? null,
      lodgingSameHouseYears: lodging?.revisits.sameHouseYearsMax ?? null,
      lodgingMonthsInYear: lodging?.calendar.monthsInYearMax ?? null,
      placeRevisitGapYears: places?.revisits.longestGapYears ?? null,
      placeTripCategoriesMax: places?.diversity.tripCategoriesMax ?? null,
      // A visit "documented" for the badge carries its OWN note and its OWN
      // photo — both are attached to the visit row itself, so the attribution
      // is explicit, never inferred from a trip's album.
      placeDocumentedVisits: places?.documentation.withNoteAndPhoto ?? null,
      tourCount: tourView?.all.completed ?? null,
      // A tour with no activity recorded is not a kind of its own.
      tourActivitiesUnique: tourView
        ? tourView.byActivity.filter((a) => a.activity !== "unknown").length
        : null,
      // Only climbs a recording measured; an unknown climb stays unknown, never
      // estimated from the route.
      tourAscentM: tourView?.all.ascentM.total ?? null,
    },
  };
}

const MEASURE: Record<string, keyof InsightAchievementStats> = {
  lodging_trip_types_max: "lodgingTripTypesMax",
  lodging_same_house_years: "lodgingSameHouseYears",
  lodging_months_in_year: "lodgingMonthsInYear",
  place_revisit_gap_years: "placeRevisitGapYears",
  place_trip_categories_max: "placeTripCategoriesMax",
  place_documented_visits: "placeDocumentedVisits",
  tour_count: "tourCount",
  tour_activities_unique: "tourActivitiesUnique",
  tour_ascent_m: "tourAscentM",
};

/**
 * The badge's progress, `null` when it is not a Part K badge, or `"skip"` when
 * its source failed this run — the stored row then stays as it is.
 */
export function checkInsightAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: InsightAchievementStats
): { isUnlocked: boolean; progress: number } | "skip" | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  const value = stats[key];
  if (value === null) return "skip";
  const progress = Math.floor(value);
  return { isUnlocked: progress >= achievement.requirement, progress };
}
