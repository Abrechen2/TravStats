import type { Achievement } from "../prisma";
import {
  airportVisits,
  airportsByYear,
  longestReunions,
  quartersByAirportYear,
} from "../services/stats/flightInsights/airports";
import {
  loadFlightInsightRows,
  type FlightInsightRow,
} from "../services/stats/flightInsights/rows";

/**
 * The badges of the statistics expansion (forgejo#256 flights), measured by
 * the SAME folds the insights section draws (`services/stats/flightInsights/`)
 * — so a badge's progress and the figure on the statistics page are one
 * computation. A module of its own like `./railAchievements.ts`: the flight
 * check and stats modules are frozen at their size by the file-size ratchet.
 *
 * Every measure is LIVE (owner ruling 2026-09-20, `achievementHeld.ts`): a
 * corrected date or a deleted flight can take a badge away again.
 */

export interface InsightAchievementStats {
  /** Most airports first recorded in a single year. */
  flightNewAirportsYearMax: number;
  /** Most whole years between two visits of one airport. */
  flightAirportReunionYears: number;
  /** Most calendar quarters one airport was used in within one year (0-4). */
  flightAirportQuartersMax: number;
}

export const EMPTY_INSIGHT_STATS: InsightAchievementStats = {
  flightNewAirportsYearMax: 0,
  flightAirportReunionYears: 0,
  flightAirportQuartersMax: 0,
};

export function foldFlightInsightStats(
  rows: readonly FlightInsightRow[]
): Pick<
  InsightAchievementStats,
  "flightNewAirportsYearMax" | "flightAirportReunionYears" | "flightAirportQuartersMax"
> {
  const visits = airportVisits(rows);
  return {
    flightNewAirportsYearMax: Math.max(
      0,
      ...airportsByYear(visits).map((y) => y.discovered.length)
    ),
    flightAirportReunionYears: Math.max(0, ...longestReunions(visits).map((r) => r.years)),
    flightAirportQuartersMax: Math.max(0, ...quartersByAirportYear(visits).map((q) => q.quarters)),
  };
}

export async function calculateInsightAchievementStats(
  userId: string
): Promise<InsightAchievementStats> {
  return { ...EMPTY_INSIGHT_STATS, ...foldFlightInsightStats(await loadFlightInsightRows(userId)) };
}

const MEASURE: Record<string, keyof InsightAchievementStats> = {
  flight_new_airports_year: "flightNewAirportsYearMax",
  flight_airport_reunion_years: "flightAirportReunionYears",
  flight_airport_all_quarters: "flightAirportQuartersMax",
};

/** The requirement types this module answers — the seeds are checked against it. */
export const INSIGHT_REQUIREMENT_TYPES: readonly string[] = Object.keys(MEASURE);

/** The badge's progress, or `null` when it is not one of these badges. */
export function checkInsightAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: InsightAchievementStats
): { isUnlocked: boolean; progress: number } | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  const progress = stats[key];
  return { isUnlocked: progress >= achievement.requirement, progress };
}
