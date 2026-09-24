import type { Achievement } from "../prisma";
import { prisma } from "../db";
import { getCountryResolver } from "../services/geo/countryFromCoordinates";
import {
  nightsOf,
  spanOf,
  stationCountries,
  STATION_SELECT,
} from "../services/roadtrip/roadtripSummary";
import { travelledKm } from "../services/tour/tourDistance";

/**
 * The roadtrip badges (2.7) — their measures and their check, in a module of
 * their own. The flight/place check and stats modules are frozen at their
 * size by the file-size ratchet; a new domain's badges belong beside them, not
 * inside them.
 *
 * Counting follows the one roadtrip rule: a roadtrip that has not started is
 * planned and counts for nothing, nights come from `countRoadtripNights` (so
 * a stay night is never counted twice), and countries from the one
 * station-country rule.
 */

export interface RoadtripAchievementStats {
  roadtripsCount: number;
  roadtripKm: number;
  roadtripFreeNights: number;
  roadtripLongestKm: number;
  roadtripCountriesMax: number;
}

export const EMPTY_ROADTRIP_STATS: RoadtripAchievementStats = {
  roadtripsCount: 0,
  roadtripKm: 0,
  roadtripFreeNights: 0,
  roadtripLongestKm: 0,
  roadtripCountriesMax: 0,
};

export async function calculateRoadtripAchievementStats(
  userId: string,
  now = new Date()
): Promise<RoadtripAchievementStats> {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip" },
    select: {
      legs: { select: { distanceKm: true } },
      stops: { select: STATION_SELECT },
    },
  });
  if (rows.length === 0) return EMPTY_ROADTRIP_STATS;

  const resolver = await getCountryResolver();
  const stats = { ...EMPTY_ROADTRIP_STATS };
  for (const row of rows) {
    const { startDate } = spanOf(row.stops);
    if (startDate && Date.parse(startDate) > now.getTime()) continue;
    const km = travelledKm(row.legs);
    stats.roadtripsCount += 1;
    stats.roadtripKm += km;
    stats.roadtripFreeNights += nightsOf(row.stops).freeNights;
    stats.roadtripLongestKm = Math.max(stats.roadtripLongestKm, km);
    stats.roadtripCountriesMax = Math.max(
      stats.roadtripCountriesMax,
      stationCountries(row.stops, resolver).length
    );
  }
  return stats;
}

const MEASURE: Record<string, keyof RoadtripAchievementStats> = {
  roadtrip_count: "roadtripsCount",
  roadtrip_km: "roadtripKm",
  roadtrip_free_nights: "roadtripFreeNights",
  roadtrip_longest_km: "roadtripLongestKm",
  roadtrip_countries_single: "roadtripCountriesMax",
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
