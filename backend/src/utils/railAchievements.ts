import type { Achievement } from "../prisma";
import { prisma } from "../db";
import { countableRailWhere, railCountries, stationDayKey } from "../shared/railCounting";
import {
  isCrossBorderRide,
  isHighSpeedRide,
  isNightTrainRide,
  operatorKey,
  rideKm,
} from "../shared/railRideKinds";
import { longestStationReturnYears, newConnectionsByYear } from "../shared/railConnections";
import { isDocumentedTransferJourney, railJourneysOf } from "../services/rail/railJourneyStats";

/**
 * The rail badges (2.7, owner 2026-09-26: "rail achievements go into 2.7 now")
 * — their measures and their check, in a module of their own like the
 * roadtrip badges beside it: the flight/place check and stats modules are
 * frozen at their size by the file-size ratchet.
 *
 * Which rides count is `shared/railCounting.ts` (completed only; scheduled,
 * running and cancelled never). What kind of ride it was, and how many
 * kilometres it counts for, is `shared/railRideKinds.ts`. This file only folds.
 *
 * The badges are hidden with the `railDomain` beta gate off: the frontend's
 * `useEnabledDomains` drops `rail` then, and with it every `domain: "rail"`
 * badge. Measuring them regardless costs one query and keeps a badge's date
 * true the day the gate comes off.
 */

export interface RailAchievementStats {
  railRidesCount: number;
  railKm: number;
  railCountries: number;
  railNightTrains: number;
  railOperators: number;
  railLongestKm: number;
  railHighSpeedRides: number;
  railCrossBorderRides: number;
  /** Most whole years between two visits of one station (forgejo#261, "Bahnhofs-Wiedersehen"). */
  railStationReturnYears: number;
  /** Journeys with a change whose every train carries both clocks ("Gut umgestiegen"). */
  railDocumentedTransferJourneys: number;
  /** The most connections first recorded in any one year ("Neue Schienen"). */
  railNewConnectionsYearMax: number;
}

export const EMPTY_RAIL_STATS: RailAchievementStats = {
  railRidesCount: 0,
  railKm: 0,
  railCountries: 0,
  railNightTrains: 0,
  railOperators: 0,
  railLongestKm: 0,
  railHighSpeedRides: 0,
  railCrossBorderRides: 0,
  railStationReturnYears: 0,
  railDocumentedTransferJourneys: 0,
  railNewConnectionsYearMax: 0,
};

/** The columns a ride's facts need — the frozen line stays out of the query. */
export const RAIL_BADGE_SELECT = {
  id: true,
  operator: true,
  trainCategory: true,
  trainNumber: true,
  travelClass: true,
  depStationName: true,
  arrStationName: true,
  // Station identity, connections and the change between two trains (forgejo#261).
  depStationCode: true,
  arrStationCode: true,
  depStationId: true,
  arrStationId: true,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
  bookingId: true,
  depCountry: true,
  arrCountry: true,
  depTimezone: true,
  arrTimezone: true,
  departureTime: true,
  arrivalTime: true,
  depPrecision: true,
  arrPrecision: true,
  distanceKm: true,
} as const;

export interface RailBadgeRow {
  id: string;
  operator: string | null;
  trainCategory: string | null;
  trainNumber: string | null;
  travelClass: string | null;
  depStationName: string;
  arrStationName: string;
  depStationCode: string | null;
  arrStationCode: string | null;
  depStationId: number | null;
  arrStationId: number | null;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  bookingId: string | null;
  depCountry: string | null;
  arrCountry: string | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  /** ADR 0002 precision of each end; `day` = logged date-only (forgejo#132 item 17). */
  depPrecision: string | null;
  arrPrecision: string | null;
  distanceKm: number | null;
}

/** What ONE ride contributes to each badge — the evidence panel lists exactly this. */
export interface RailRideFacts {
  km: number | null;
  countries: string[];
  operator: string | null;
  isNightTrain: boolean;
  isHighSpeed: boolean;
  isCrossBorder: boolean;
}

/** What `railRideFacts` reads — the rail statistics' rows carry it too. */
export type RailFactsInput = Pick<
  RailBadgeRow,
  | "operator"
  | "trainCategory"
  | "travelClass"
  | "depCountry"
  | "arrCountry"
  | "depTimezone"
  | "arrTimezone"
  | "departureTime"
  | "arrivalTime"
  | "depPrecision"
  | "arrPrecision"
  | "distanceKm"
>;

export function railRideFacts(row: RailFactsInput): RailRideFacts {
  const depDayKey = stationDayKey(row.departureTime, row.depTimezone);
  const arrDayKey = row.arrivalTime ? stationDayKey(row.arrivalTime, row.arrTimezone) : null;
  return {
    km: rideKm(row),
    countries: railCountries(row),
    operator: operatorKey(row.operator),
    isNightTrain: isNightTrainRide({ ...row, depDayKey, arrDayKey }),
    isHighSpeed: isHighSpeedRide(row),
    isCrossBorder: isCrossBorderRide(row),
  };
}

/** The counted rides, oldest first. */
export async function loadRailBadgeRows(userId: string): Promise<RailBadgeRow[]> {
  return prisma.railJourney.findMany({
    where: { userId, ...countableRailWhere() },
    select: RAIL_BADGE_SELECT,
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
  });
}

/** Pure fold over already-counted rides. */
export function foldRailAchievementStats(rows: readonly RailBadgeRow[]): RailAchievementStats {
  const countries = new Set<string>();
  const operators = new Set<string>();
  const stats = { ...EMPTY_RAIL_STATS };
  for (const row of rows) {
    const facts = railRideFacts(row);
    stats.railRidesCount += 1;
    stats.railKm += facts.km ?? 0;
    stats.railLongestKm = Math.max(stats.railLongestKm, facts.km ?? 0);
    facts.countries.forEach((c) => countries.add(c));
    if (facts.operator) operators.add(facts.operator);
    if (facts.isNightTrain) stats.railNightTrains += 1;
    if (facts.isHighSpeed) stats.railHighSpeedRides += 1;
    if (facts.isCrossBorder) stats.railCrossBorderRides += 1;
  }
  return {
    ...stats,
    railCountries: countries.size,
    railOperators: operators.size,
    railStationReturnYears: longestStationReturnYears(rows),
    railDocumentedTransferJourneys: railJourneysOf(rows).filter(isDocumentedTransferJourney).length,
    railNewConnectionsYearMax: Math.max(0, ...newConnectionsByYear(rows).values()),
  };
}

export async function calculateRailAchievementStats(userId: string): Promise<RailAchievementStats> {
  return foldRailAchievementStats(await loadRailBadgeRows(userId));
}

const MEASURE: Record<string, keyof RailAchievementStats> = {
  rail_count: "railRidesCount",
  rail_km: "railKm",
  rail_countries: "railCountries",
  rail_night_trains: "railNightTrains",
  rail_operators: "railOperators",
  rail_longest_km: "railLongestKm",
  rail_high_speed: "railHighSpeedRides",
  rail_cross_border: "railCrossBorderRides",
  rail_station_return_years: "railStationReturnYears",
  rail_documented_transfer_journeys: "railDocumentedTransferJourneys",
  rail_new_connections_year: "railNewConnectionsYearMax",
};

/** The requirement types this module answers — the seeds are checked against it. */
export const RAIL_REQUIREMENT_TYPES: readonly string[] = Object.keys(MEASURE);

/** The badge's progress, or `null` when it is not a rail badge. */
export function checkRailAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: RailAchievementStats
): { isUnlocked: boolean; progress: number } | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  // Rounded, not floored: the evidence panel behind a rail badge rounds the
  // same kilometres once (`domainSumEvidence`), and a floor here would put the
  // badge and the list of its rides one km apart on every .5.
  const progress = Math.round(stats[key]);
  return { isUnlocked: progress >= achievement.requirement, progress };
}
