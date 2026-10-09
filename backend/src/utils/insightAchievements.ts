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
import { excursionsOf } from "../services/stats/cruiseInsights/excursions";
import {
  linkedToursOf,
  loadCruiseInsightContext,
  type CruiseInsightContext,
} from "../services/stats/cruiseInsights/load";
import { cruisesPerPort, repeatedItineraries } from "../services/stats/cruiseInsights/ports";

/**
 * The badges of the statistics expansion (forgejo#256 flights, #257 cruises),
 * measured by the SAME folds the insights sections draw
 * (`services/stats/flightInsights/`, `services/stats/cruiseInsights/`)
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
  /** Most sailed cruises one catalogue port was on. */
  cruisePortCruisesMax: number;
  /**
   * Catalogue ports with a documented shore excursion (a note, or a linked
   * day tour while the reader sees tours — a hidden domain never counts).
   */
  cruiseExcursionPorts: number;
  /** Most sailed cruises sharing one identical port sequence. */
  cruiseRepeatedItineraryMax: number;
}

export const EMPTY_INSIGHT_STATS: InsightAchievementStats = {
  flightNewAirportsYearMax: 0,
  flightAirportReunionYears: 0,
  flightAirportQuartersMax: 0,
  cruisePortCruisesMax: 0,
  cruiseExcursionPorts: 0,
  cruiseRepeatedItineraryMax: 0,
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

export function foldCruiseInsightStats(
  ctx: CruiseInsightContext
): Pick<
  InsightAchievementStats,
  "cruisePortCruisesMax" | "cruiseExcursionPorts" | "cruiseRepeatedItineraryMax"
> {
  const excursionPorts = new Set(
    ctx.rows.flatMap((row) => excursionsOf(row, linkedToursOf(ctx, row.id)).documentedPortIds)
  );
  return {
    cruisePortCruisesMax: Math.max(0, ...cruisesPerPort(ctx.rows).map((p) => p.cruiseIds.length)),
    cruiseExcursionPorts: excursionPorts.size,
    cruiseRepeatedItineraryMax: Math.max(
      0,
      ...repeatedItineraries(ctx.rows, 1).map((g) => g.cruiseIds.length)
    ),
  };
}

export async function calculateInsightAchievementStats(
  userId: string
): Promise<InsightAchievementStats> {
  const [flights, cruises] = await Promise.all([
    loadFlightInsightRows(userId),
    loadCruiseInsightContext(userId),
  ]);
  return { ...foldFlightInsightStats(flights), ...foldCruiseInsightStats(cruises) };
}

const MEASURE: Record<string, keyof InsightAchievementStats> = {
  flight_new_airports_year: "flightNewAirportsYearMax",
  flight_airport_reunion_years: "flightAirportReunionYears",
  flight_airport_all_quarters: "flightAirportQuartersMax",
  cruise_port_cruises: "cruisePortCruisesMax",
  cruise_excursion_ports: "cruiseExcursionPorts",
  cruise_repeated_itinerary: "cruiseRepeatedItineraryMax",
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
