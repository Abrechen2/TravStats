import type { Achievement } from "../prisma";
import { now as clockNow } from "../shared/time/clock";
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
import {
  loadTourFacts,
  lodgingInsights,
  placeInsights,
  tourInsights,
} from "../services/stats/insights";
import type { TourFacts } from "./tourInsights/tourFacts";
import type { LodgingInsightsResponse } from "../schemas/statsInsights/lodging";
import type { PlaceInsightsResponse } from "../schemas/statsInsights/places";
import type { TourInsightsResponse } from "../schemas/statsInsights/tours";
import type { CruiseData } from "./cruiseStats";
import { SKIP, settleBadgeSource, type BadgeVerdict } from "./badgeSource";
import {
  calculateRoadtripAchievementStats,
  type RoadtripAchievementStats,
} from "./roadtripAchievements";

/**
 * The badges of the statistics expansion — flights (forgejo#256), cruises
 * (#257), lodging (#258), places (#259), roadtrips (#260) and tours (#264) —
 * measured by the SAME builders the statistics sections draw
 * (`services/stats/flightInsights/`, `services/stats/cruiseInsights/`,
 * `services/stats/insights/`), so a badge's progress and the figure on the
 * statistics page are one computation. A module of its own: the flight check
 * and stats modules are frozen at their size by the file-size ratchet.
 *
 * Every measure is LIVE (owner ruling 2026-09-20, `achievementHeld.ts`): a
 * corrected date or a deleted flight can take a badge away again.
 *
 * ## One check, each source read once
 *
 * The badge check has already loaded the user's counted flights and sailed
 * cruises with their stops; those rows are handed in (`InsightSources`), so
 * neither table is read a second time. The tours are loaded ONCE, without
 * elevation profiles (no badge reads them), and serve the tour badges, the
 * roadtrip badges and the cruise excursion link alike.
 *
 * ## Failure
 *
 * Every source runs through `settleBadgeSource` (`badgeSource.ts`, the one
 * failure rule of the check): a source that throws is logged, its measures
 * come back `null`, and their badges answer `SKIP` — the stored rows stay as
 * they are, every other badge is still checked.
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

export const EMPTY_INSIGHT_STATS: InsightAchievementStats = {
  ...ZERO_FLIGHT,
  ...ZERO_CRUISE,
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

async function flightHalf(userId: string, sources: InsightSources): Promise<FlightHalf> {
  if (sources.flights.length === 0) return ZERO_FLIGHT;
  const half = await settleBadgeSource(userId, "flightInsights", async () =>
    foldFlightInsightStats(await toFlightInsightRows(sources.flights))
  );
  return half ?? UNMEASURED_FLIGHT;
}

/**
 * The cruise half. `tours` null = the tour load failed: the two measures that
 * never read a tour are still taken, the excursion count is left unmeasured
 * while the instance shows tours (a notes-only count could write it down).
 */
async function cruiseHalf(
  userId: string,
  sources: InsightSources,
  tours: readonly TourFacts[] | null
): Promise<CruiseHalf> {
  if (sources.cruises.length === 0) return ZERO_CRUISE;
  const half = await settleBadgeSource(userId, "cruiseInsights", async () => {
    const rows = sources.cruises.map((c) => cruiseInsightRowOf({ ...c, label: "" }, c.stops));
    const ctx = await cruiseInsightContextOf(
      userId,
      { rows, userBirthday: sources.userBirthday },
      { tours: tours ?? [] }
    );
    const folded = foldCruiseInsightStats(ctx);
    return tours === null && ctx.toursVisible ? { ...folded, cruiseExcursionPorts: null } : folded;
  });
  return half ?? UNMEASURED_CRUISE;
}

/**
 * Every statistics-expansion measure plus the roadtrip ones, each source read
 * ONCE (see the module comment).
 */
export async function calculateInsightBadgeStats(
  userId: string,
  sources: InsightSources,
  at: Date = clockNow()
): Promise<{
  roadtripStats: RoadtripAchievementStats | null;
  insightStats: InsightAchievementStats;
}> {
  const tours = await settleBadgeSource(userId, "tours", () =>
    loadTourFacts(userId, at, { withElevation: false })
  );
  const [flights, cruises, roadtripStats, lodging, places, tourView] = await Promise.all([
    flightHalf(userId, sources),
    cruiseHalf(userId, sources, tours),
    tours === null
      ? null
      : settleBadgeSource(userId, "roadtrips", () =>
          calculateRoadtripAchievementStats(userId, at, tours)
        ),
    settleBadgeSource(userId, "lodging", () => lodgingInsights(userId, at).then((r) => r.response)),
    settleBadgeSource(userId, "places", () => placeInsights(userId, at).then((r) => r.response)),
    tours === null
      ? null
      : settleBadgeSource(userId, "tourInsights", () =>
          tourInsights(userId, at, { tours }).then((r) => r.response)
        ),
  ]);
  return {
    roadtripStats,
    insightStats: {
      ...flights,
      ...cruises,
      ...lodgingBadgeFields(lodging),
      ...placeBadgeFields(places),
      ...tourBadgeFields(tourView),
    },
  };
}

type LodgingView = Pick<LodgingInsightsResponse, "tripBases" | "revisits" | "calendar">;
type PlaceView = Pick<PlaceInsightsResponse, "revisits" | "diversity" | "documentation">;
type TourView = Pick<TourInsightsResponse, "all" | "byActivity">;

/**
 * The badge measures read off each statistics view — one home for the
 * badge check and for the badge evidence (`services/evidence/badges/`),
 * which folds subsets of the same rows. A null view = the source failed.
 */
export function lodgingBadgeFields(
  lodging: LodgingView | null
): Pick<
  InsightAchievementStats,
  "lodgingTripTypesMax" | "lodgingSameHouseYears" | "lodgingMonthsInYear"
> {
  return {
    lodgingTripTypesMax: lodging?.tripBases.typesPerCompletedTripMax ?? null,
    lodgingSameHouseYears: lodging?.revisits.sameHouseYearsMax ?? null,
    lodgingMonthsInYear: lodging?.calendar.monthsInYearMax ?? null,
  };
}

export function placeBadgeFields(
  places: PlaceView | null
): Pick<
  InsightAchievementStats,
  "placeRevisitGapYears" | "placeTripCategoriesMax" | "placeDocumentedVisits"
> {
  return {
    placeRevisitGapYears: places?.revisits.longestGapYears ?? null,
    placeTripCategoriesMax: places?.diversity.tripCategoriesMax ?? null,
    // A visit "documented" for the badge carries its OWN note and its OWN
    // photo — both are attached to the visit row itself, so the attribution
    // is explicit, never inferred from a trip's album.
    placeDocumentedVisits: places?.documentation.withNoteAndPhoto ?? null,
  };
}

export function tourBadgeFields(
  tourView: TourView | null
): Pick<InsightAchievementStats, "tourCount" | "tourActivitiesUnique" | "tourAscentM"> {
  return {
    tourCount: tourView?.all.completed ?? null,
    // A tour with no activity recorded is not a kind of its own.
    tourActivitiesUnique: tourView
      ? tourView.byActivity.filter((a) => a.activity !== "unknown").length
      : null,
    // Only climbs a recording measured; an unknown climb stays unknown, never
    // estimated from the route.
    tourAscentM: tourView?.all.ascentM.total ?? null,
  };
}

const MEASURE: Record<string, keyof InsightAchievementStats> = {
  flight_new_airports_year: "flightNewAirportsYearMax",
  flight_airport_reunion_years: "flightAirportReunionYears",
  flight_airport_all_quarters: "flightAirportQuartersMax",
  cruise_port_cruises: "cruisePortCruisesMax",
  cruise_excursion_ports: "cruiseExcursionPorts",
  cruise_repeated_itinerary: "cruiseRepeatedItineraryMax",
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

/** The requirement types this module answers — the seeds are checked against it. */
export const INSIGHT_REQUIREMENT_TYPES: readonly string[] = Object.keys(MEASURE);

/**
 * The badge's progress; `SKIP` when its source failed this run (the planner
 * then leaves the stored row alone); `null` when it is not one of these
 * badges.
 */
export function checkInsightAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: InsightAchievementStats
): BadgeVerdict | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  const value = stats[key];
  if (value === null) return SKIP;
  const progress = Math.floor(value);
  return { isUnlocked: progress >= achievement.requirement, progress };
}
