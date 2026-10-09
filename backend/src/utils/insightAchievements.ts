import type { Achievement } from "../prisma";
import logger from "./logger";
import {
  airportVisits,
  airportsByYear,
  longestReunions,
  quartersByAirportYear,
} from "../services/stats/flightInsights/airports";
import {
  toFlightInsightRows,
  type FlightInsightRow,
  type FlightInsightSource,
} from "../services/stats/flightInsights/rows";
import { excursionsOf } from "../services/stats/cruiseInsights/excursions";
import {
  cruiseInsightContextOf,
  linkedToursOf,
  type CruiseInsightContext,
} from "../services/stats/cruiseInsights/load";
import { cruisesPerPort, repeatedItineraries } from "../services/stats/cruiseInsights/ports";
import { cruiseInsightRowOf, type CruiseStopSource } from "../services/stats/cruiseInsights/rows";
import type { CruiseData } from "./cruiseStats";

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
 *
 * ## Cost and failure (review of forgejo#256/#257, fix round 1)
 *
 * The badge check has already loaded the user's counted flights and sailed
 * cruises with their stops; those rows are handed in (`InsightSources`), so
 * neither table is read a second time. A half with no rows is not measured
 * at all, and tours are asked for only when the instance shows them and a
 * port call has a day. A half that throws is logged and comes back UNMEASURED
 * (`null`): its badges keep their stored progress for this run instead of
 * aborting every other badge, or being written down to zero.
 */

/** `null` = not measured this run: the badge keeps what it had. */
export interface InsightAchievementStats {
  /** Most airports first recorded in a single year, the first recorded year excluded. */
  flightNewAirportsYearMax: number | null;
  /** Most whole years between two visits of one airport. */
  flightAirportReunionYears: number | null;
  /** Most calendar quarters one airport was used in within one year (0-4). */
  flightAirportQuartersMax: number | null;
  /** Most sailed cruises one catalogue port was CALLED at on (embarkation/disembarkation excluded). */
  cruisePortCruisesMax: number | null;
  /**
   * Catalogue ports with a documented shore excursion (a note, or a linked
   * day tour while the instance shows tours — the web's own rule).
   */
  cruiseExcursionPorts: number | null;
  /** Most sailed cruises sharing one identical port sequence. */
  cruiseRepeatedItineraryMax: number | null;
}

type FlightHalf = Pick<
  InsightAchievementStats,
  "flightNewAirportsYearMax" | "flightAirportReunionYears" | "flightAirportQuartersMax"
>;
type CruiseHalf = Pick<
  InsightAchievementStats,
  "cruisePortCruisesMax" | "cruiseExcursionPorts" | "cruiseRepeatedItineraryMax"
>;

const ZERO_FLIGHT: FlightHalf = {
  flightNewAirportsYearMax: 0,
  flightAirportReunionYears: 0,
  flightAirportQuartersMax: 0,
};
const ZERO_CRUISE: CruiseHalf = {
  cruisePortCruisesMax: 0,
  cruiseExcursionPorts: 0,
  cruiseRepeatedItineraryMax: 0,
};
const UNMEASURED_FLIGHT: FlightHalf = {
  flightNewAirportsYearMax: null,
  flightAirportReunionYears: null,
  flightAirportQuartersMax: null,
};
const UNMEASURED_CRUISE: CruiseHalf = {
  cruisePortCruisesMax: null,
  cruiseExcursionPorts: null,
  cruiseRepeatedItineraryMax: null,
};

export const EMPTY_INSIGHT_STATS: InsightAchievementStats = { ...ZERO_FLIGHT, ...ZERO_CRUISE };

export function foldFlightInsightStats(rows: readonly FlightInsightRow[]): FlightHalf {
  const visits = airportVisits(rows);
  return {
    // The first recorded year is left out (owner ruling 2026-10-09): every
    // airport is "new" there, so any account with one year would earn it.
    flightNewAirportsYearMax: Math.max(
      0,
      ...airportsByYear(visits)
        .slice(1)
        .map((y) => y.discovered.length)
    ),
    flightAirportReunionYears: Math.max(0, ...longestReunions(visits).map((r) => r.years)),
    flightAirportQuartersMax: Math.max(0, ...quartersByAirportYear(visits).map((q) => q.quarters)),
  };
}

export function foldCruiseInsightStats(ctx: CruiseInsightContext): CruiseHalf {
  const excursionPorts = new Set(
    ctx.rows.flatMap((row) => excursionsOf(row, linkedToursOf(ctx, row.id)).documentedPortIds)
  );
  return {
    cruisePortCruisesMax: Math.max(
      0,
      ...cruisesPerPort(ctx.rows, { callsOnly: true }).map((p) => p.cruiseIds.length)
    ),
    cruiseExcursionPorts: excursionPorts.size,
    cruiseRepeatedItineraryMax: Math.max(
      0,
      ...repeatedItineraries(ctx.rows, 1).map((g) => g.cruiseIds.length)
    ),
  };
}

/** What the badge check already holds — nothing here reads those tables again. */
export interface InsightSources {
  /** The counted (flown, historical) flights. */
  flights: readonly FlightInsightSource[];
  /** The sailed cruises: the calculator input and the stops with their ports. */
  cruises: ReadonlyArray<{ id: string; input: CruiseData; stops: readonly CruiseStopSource[] }>;
  userBirthday?: { month: number; day: number };
}

/** Runs one half; a throw is logged and the half comes back unmeasured. */
async function isolated<T>(
  userId: string,
  half: string,
  unmeasured: T,
  measure: () => Promise<T>
): Promise<T> {
  try {
    return await measure();
  } catch (error) {
    logger.error({
      operation: "insight_achievement_measure_failed",
      message: "An insight badge measure failed; its badges keep their stored progress",
      context: { userId, half },
      error: { message: error instanceof Error ? error.message : String(error) },
    });
    return unmeasured;
  }
}

export async function calculateInsightAchievementStats(
  userId: string,
  sources: InsightSources
): Promise<InsightAchievementStats> {
  const flights = await isolated(userId, "flight", UNMEASURED_FLIGHT, async () =>
    sources.flights.length === 0
      ? ZERO_FLIGHT
      : foldFlightInsightStats(await toFlightInsightRows(sources.flights))
  );
  const cruises = await isolated(userId, "cruise", UNMEASURED_CRUISE, async () => {
    if (sources.cruises.length === 0) return ZERO_CRUISE;
    const rows = sources.cruises.map((c) => cruiseInsightRowOf({ ...c, label: "" }, c.stops));
    return foldCruiseInsightStats(
      await cruiseInsightContextOf(userId, { rows, userBirthday: sources.userBirthday })
    );
  });
  return { ...flights, ...cruises };
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

/**
 * The badge's progress; `"unmeasured"` when its measure failed this run (the
 * caller then leaves the stored row alone); `null` when it is not one of
 * these badges.
 */
export function checkInsightAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: InsightAchievementStats
): { isUnlocked: boolean; progress: number } | "unmeasured" | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  const progress = stats[key];
  if (progress === null) return "unmeasured";
  return { isUnlocked: progress >= achievement.requirement, progress };
}
