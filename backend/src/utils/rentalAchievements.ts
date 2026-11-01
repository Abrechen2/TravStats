import type { Achievement } from "../prisma";
import { prisma } from "../db";
import {
  countableRentalWhere,
  odometerDistanceKm,
  rentalCountries,
  rentalDays,
} from "../shared/rentalCounting";
import { operatorKey } from "../shared/railRideKinds";
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
 * The depth rungs (forgejo#405, thresholds a proposal): kilometres are the
 * odometer pairs only — the badge rewards data, so an invoice figure or an
 * estimate never feeds it; countries are the stations' stored countries
 * (`rentalCountries`); a company is the folded provider name; the long rental
 * is the most calendar days of one (`rentalDays`).
 *
 * Hidden while the user has the rental domain off: `services/achievementVisibility`
 * drops every `domain: "rental"` badge from lists, counts and points then.
 */

export interface RentalAchievementStats {
  rentalCount: number;
  rentalOneWayCount: number;
  rentalOdometerDocumented: number;
  rentalOdometerKm: number;
  rentalCountries: number;
  rentalCompanies: number;
  rentalLongestDays: number;
}

export const EMPTY_RENTAL_STATS: RentalAchievementStats = {
  rentalCount: 0,
  rentalOneWayCount: 0,
  rentalOdometerDocumented: 0,
  rentalOdometerKm: 0,
  rentalCountries: 0,
  rentalCompanies: 0,
  rentalLongestDays: 0,
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
  pickupCountry: true,
  returnCountry: true,
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
  pickupCountry: string | null;
  returnCountry: string | null;
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
    rentalOdometerKm: rows.reduce(
      (sum, r) => sum + (odometerDistanceKm(r.odometerOutKm, r.odometerInKm) ?? 0),
      0
    ),
    rentalCountries: new Set(rows.flatMap((r) => rentalCountries(r))).size,
    rentalCompanies: new Set(rows.flatMap((r) => operatorKey(r.provider) ?? [])).size,
    rentalLongestDays: Math.max(0, ...rows.map((r) => rentalDays(r))),
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
  rental_odometer_km: "rentalOdometerKm",
  rental_countries: "rentalCountries",
  rental_companies: "rentalCompanies",
  rental_longest_days: "rentalLongestDays",
};

export const RENTAL_REQUIREMENT_TYPES: readonly string[] = Object.keys(MEASURE);

/** The badge's progress, or `null` when it is not a rental badge. */
export function checkRentalAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: RentalAchievementStats
): { isUnlocked: boolean; progress: number } | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  const progress = Math.round(stats[key]);
  return { isUnlocked: progress >= achievement.requirement, progress };
}
