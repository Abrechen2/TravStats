import { prisma } from "../db";
import type { Achievement } from "../prisma";
import { countableFerryWhere, ferryCountries } from "../shared/ferryCounting";
import { isNightBusRide, terminalsOf } from "../shared/busRideKinds";
import { operatorKey, rideKm } from "../shared/railRideKinds";

/**
 * The ferry badges — their measures and their check, beside the bus and rental
 * modules. Which crossings count is `shared/ferryCounting.ts` (completed only).
 * An overnight crossing is the night rule bus and rail use (`isNightBusRide`:
 * a later day on the arrival port's calendar, enough hours on board, a clock at
 * both ends — a date-only crossing is never made into a night), and a port is
 * the terminal identity of `busRideKinds.terminalsOf` (one name within a few
 * kilometres is one port), so a ferry badge and the bus badges cannot count
 * the same kind of thing differently.
 *
 * The depth rungs (forgejo#405, thresholds a proposal) follow the bus badges:
 * kilometres are `rideKm` (no distance counts for nothing, never 0), countries
 * come from the ports' stored countries, a line is `operatorKey`, and a
 * crossing "with a vehicle aboard" is one whose record names a vehicle type or
 * a registration — a passenger count or a cabin is not a vehicle.
 *
 * Hidden while the user has the ferry domain off: `services/achievementVisibility`
 * drops every `domain: "ferry"` badge from lists, counts and points then.
 */

export interface FerryAchievementStats {
  ferryCrossingsCount: number;
  ferryNightCrossings: number;
  ferryPorts: number;
  ferryKm: number;
  ferryCountries: number;
  ferryOperators: number;
  ferryVehicleCrossings: number;
}

export const FERRY_BADGE_SELECT = {
  id: true,
  operator: true,
  depCountry: true,
  arrCountry: true,
  distanceKm: true,
  vehicleType: true,
  vehicleRegistration: true,
  depStationName: true,
  depLat: true,
  depLon: true,
  arrStationName: true,
  arrLat: true,
  arrLon: true,
  departureTime: true,
  arrivalTime: true,
  depTimezone: true,
  arrTimezone: true,
  depPrecision: true,
  arrPrecision: true,
} as const;

/** The counted crossings, oldest first. */
export function loadFerryBadgeRows(userId: string) {
  return prisma.ferryJourney.findMany({
    where: { userId, ...countableFerryWhere() },
    select: FERRY_BADGE_SELECT,
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
  });
}

export type FerryBadgeRow = Awaited<ReturnType<typeof loadFerryBadgeRows>>[number];

/** A crossing whose record names a vehicle: a type or a registration, not blank. */
export const hasVehicle = (
  r: Pick<FerryBadgeRow, "vehicleType" | "vehicleRegistration">
): boolean => Boolean(r.vehicleType?.trim() || r.vehicleRegistration?.trim());

export function foldFerryAchievementStats(rows: readonly FerryBadgeRow[]): FerryAchievementStats {
  return {
    ferryCrossingsCount: rows.length,
    ferryNightCrossings: rows.filter(isNightBusRide).length,
    ferryPorts: terminalsOf(rows).registry.size,
    ferryKm: rows.reduce((sum, r) => sum + (rideKm(r) ?? 0), 0),
    ferryCountries: new Set(rows.flatMap((r) => ferryCountries(r))).size,
    ferryOperators: new Set(rows.flatMap((r) => operatorKey(r.operator) ?? [])).size,
    ferryVehicleCrossings: rows.filter(hasVehicle).length,
  };
}

export async function calculateFerryAchievementStats(
  userId: string
): Promise<FerryAchievementStats> {
  return foldFerryAchievementStats(await loadFerryBadgeRows(userId));
}

const MEASURE: Record<string, keyof FerryAchievementStats> = {
  ferry_count: "ferryCrossingsCount",
  ferry_night_crossings: "ferryNightCrossings",
  ferry_ports: "ferryPorts",
  ferry_km: "ferryKm",
  ferry_countries: "ferryCountries",
  ferry_operators: "ferryOperators",
  ferry_vehicle: "ferryVehicleCrossings",
};

export const FERRY_REQUIREMENT_TYPES: readonly string[] = Object.keys(MEASURE);

/** The badge's progress, or `null` when it is not a ferry badge. */
export function checkFerryAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: FerryAchievementStats
): { isUnlocked: boolean; progress: number } | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  const progress = Math.round(stats[key]);
  return { isUnlocked: progress >= achievement.requirement, progress };
}
