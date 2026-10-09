import type { Achievement } from "../prisma";
import { prisma } from "../db";
import { countableRentalWhere, odometerDistanceKm } from "../shared/rentalCounting";
import { isOneWay } from "../services/rental/rentalWrite";

/**
 * The rental badges (forgejo#262) — their measures and their check, in a
 * module of their own like the rail and roadtrip badges.
 *
 * Which rentals count is `shared/rentalCounting.ts`: completed only — a
 * booked car is no key in the hand, a cancelled one never was. A one-way
 * rental is the rule the statistics count (`rentalWrite.isOneWay`: two
 * different airports, else stations more than a kilometre apart — both
 * positions are mandatory, so both stations are always known). The odometer
 * badge rewards DATA, not distance: a rental counts when both readings are
 * known and the car did not run backwards (`odometerDistanceKm`), never on
 * an invoice figure or an estimate.
 *
 * Hidden with the `rentalDomain` beta gate off: `services/achievementVisibility`
 * drops every `domain: "rental"` badge from lists, counts and points then.
 */

export interface RentalAchievementStats {
  rentalCount: number;
  rentalOneWayCount: number;
  rentalOdometerDocumented: number;
}

export const EMPTY_RENTAL_STATS: RentalAchievementStats = {
  rentalCount: 0,
  rentalOneWayCount: 0,
  rentalOdometerDocumented: 0,
};

export const RENTAL_BADGE_SELECT = {
  id: true,
  provider: true,
  pickupStationName: true,
  returnStationName: true,
  pickupTime: true,
  pickupTimezone: true,
  returnTime: true,
  returnTimezone: true,
  pickupAirportId: true,
  returnAirportId: true,
  pickupLat: true,
  pickupLon: true,
  returnLat: true,
  returnLon: true,
  odometerOutKm: true,
  odometerInKm: true,
} as const;

export interface RentalBadgeRow {
  id: string;
  provider: string;
  pickupStationName: string;
  returnStationName: string;
  pickupTime: Date;
  pickupTimezone: string;
  returnTime: Date;
  returnTimezone: string;
  pickupAirportId: number | null;
  returnAirportId: number | null;
  pickupLat: number;
  pickupLon: number;
  returnLat: number;
  returnLon: number;
  odometerOutKm: number | null;
  odometerInKm: number | null;
}

export const hasOdometerPair = (r: RentalBadgeRow): boolean =>
  odometerDistanceKm(r.odometerOutKm, r.odometerInKm) !== null;

/** The counted rentals, oldest first. */
export async function loadRentalBadgeRows(userId: string): Promise<RentalBadgeRow[]> {
  return prisma.rentalBooking.findMany({
    where: { userId, ...countableRentalWhere() },
    select: RENTAL_BADGE_SELECT,
    orderBy: [{ pickupTime: "asc" }, { id: "asc" }],
  });
}

export function foldRentalAchievementStats(
  rows: readonly RentalBadgeRow[]
): RentalAchievementStats {
  return {
    rentalCount: rows.length,
    rentalOneWayCount: rows.filter((r) => isOneWay(r)).length,
    rentalOdometerDocumented: rows.filter(hasOdometerPair).length,
  };
}

export async function calculateRentalAchievementStats(
  userId: string
): Promise<RentalAchievementStats> {
  return foldRentalAchievementStats(await loadRentalBadgeRows(userId));
}

const MEASURE: Record<string, keyof RentalAchievementStats> = {
  rental_count: "rentalCount",
  rental_one_way: "rentalOneWayCount",
  rental_odometer_documented: "rentalOdometerDocumented",
};

export const RENTAL_REQUIREMENT_TYPES: readonly string[] = Object.keys(MEASURE);

/** The badge's progress, or `null` when it is not a rental badge. */
export function checkRentalAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: RentalAchievementStats
): { isUnlocked: boolean; progress: number } | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  const progress = stats[key];
  return { isUnlocked: progress >= achievement.requirement, progress };
}
