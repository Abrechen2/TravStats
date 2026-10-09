import type { Achievement } from "../prisma";
import { now as clockNow } from "../shared/time/clock";
import { roadtripInsights } from "../services/stats/insights";

/**
 * The roadtrip badges (2.7, Part I; and the three of the statistics expansion,
 * Part K) — their measures and their check, in a module of their own. The
 * flight/place check and stats modules are frozen at their size by the
 * file-size ratchet; a new domain's badges belong beside them, not inside them.
 *
 * Every measure is read off the roadtrip insights (`utils/roadtripInsights`),
 * the same computation the statistics tab draws, through the one timeline rule
 * (`shared/tour/roadtripTimeline.ts`): a roadtrip that has not started counts
 * for nothing, and — since forgejo#260 — of one that HAS started only what has
 * happened counts. Until then the kilometres of next week's ferry reached the
 * badges on the first morning (the extension to #179). Nights come from
 * `countRoadtripNights` (a stay night is never counted twice), countries from
 * the one station-country rule.
 */
export interface RoadtripAchievementStats {
  roadtripsCount: number;
  roadtripKm: number;
  roadtripFreeNights: number;
  roadtripLongestKm: number;
  roadtripCountriesMax: number;
  roadtripBaseCamps: number;
  roadtripLandAndWater: number;
  roadtripTourStations: number;
}

export const EMPTY_ROADTRIP_STATS: RoadtripAchievementStats = {
  roadtripsCount: 0,
  roadtripKm: 0,
  roadtripFreeNights: 0,
  roadtripLongestKm: 0,
  roadtripCountriesMax: 0,
  roadtripBaseCamps: 0,
  roadtripLandAndWater: 0,
  roadtripTourStations: 0,
};

export async function calculateRoadtripAchievementStats(
  userId: string,
  now: Date = clockNow()
): Promise<RoadtripAchievementStats> {
  const { awards } = await roadtripInsights(userId, now);
  return {
    roadtripsCount: awards.roadtripsCount,
    roadtripKm: awards.recordedKm,
    roadtripFreeNights: awards.recordedFreeNights,
    roadtripLongestKm: awards.longestRecordedKm,
    roadtripCountriesMax: awards.recordedCountriesMax,
    roadtripBaseCamps: awards.baseCampStations,
    roadtripLandAndWater: awards.landAndWaterTrips,
    roadtripTourStations: awards.tourStations,
  };
}

const MEASURE: Record<string, keyof RoadtripAchievementStats> = {
  roadtrip_count: "roadtripsCount",
  roadtrip_km: "roadtripKm",
  roadtrip_free_nights: "roadtripFreeNights",
  roadtrip_longest_km: "roadtripLongestKm",
  roadtrip_countries_single: "roadtripCountriesMax",
  roadtrip_base_camp: "roadtripBaseCamps",
  roadtrip_land_and_water: "roadtripLandAndWater",
  roadtrip_tour_stations: "roadtripTourStations",
};

/** The badge's progress, or `null` when it is not a roadtrip badge. */
export function checkRoadtripAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: RoadtripAchievementStats
): { isUnlocked: boolean; progress: number } | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  const progress = Math.floor(stats[key]);
  return { isUnlocked: progress >= achievement.requirement, progress };
}
