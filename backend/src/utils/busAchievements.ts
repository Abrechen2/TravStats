import type { Achievement } from "../prisma";
import { busCountries } from "../shared/busCounting";
import { isNightBusRide, terminalsOf } from "../shared/busRideKinds";
import { isCrossBorderRide, operatorKey, rideKm } from "../shared/railRideKinds";
import { loadBusRows, type BusStatsRow } from "../services/bus/busStats";

/**
 * The bus badges (forgejo#263) — their measures and their check, beside the
 * rail and rental modules. Which rides count is `shared/busCounting.ts`
 * (completed only); what a night bus is and which terminal is which is
 * `shared/busRideKinds.ts`, the rules the bus tab reads, so a badge and the
 * tab cannot disagree.
 *
 * The depth rungs (forgejo#405, thresholds a proposal) read the rules rail
 * reads, so a coach ride and a train ride are never counted two ways:
 * kilometres are `rideKm` (a ride without a distance counts for nothing,
 * never 0), countries and the border ride come from the terminals' stored
 * countries (a terminal the geocoder could not place proves no border), an
 * operator is `operatorKey`, and the long ride is the longest single `rideKm`.
 *
 * Hidden while the user has the bus domain off: `services/achievementVisibility`
 * drops every `domain: "bus"` badge from lists, counts and points then.
 */

export interface BusAchievementStats {
  busRidesCount: number;
  busNightRides: number;
  busTerminals: number;
  busKm: number;
  busCountries: number;
  busCrossBorderRides: number;
  busOperators: number;
  busLongestKm: number;
}

export function foldBusAchievementStats(rows: readonly BusStatsRow[]): BusAchievementStats {
  return {
    busRidesCount: rows.length,
    busNightRides: rows.filter(isNightBusRide).length,
    busTerminals: terminalsOf(rows).registry.size,
    busKm: rows.reduce((sum, r) => sum + (rideKm(r) ?? 0), 0),
    busCountries: new Set(rows.flatMap((r) => busCountries(r))).size,
    busCrossBorderRides: rows.filter(isCrossBorderRide).length,
    busOperators: new Set(rows.flatMap((r) => operatorKey(r.operator) ?? [])).size,
    busLongestKm: Math.max(0, ...rows.map((r) => rideKm(r) ?? 0)),
  };
}

export async function calculateBusAchievementStats(userId: string): Promise<BusAchievementStats> {
  return foldBusAchievementStats(await loadBusRows(userId));
}

const MEASURE: Record<string, keyof BusAchievementStats> = {
  bus_count: "busRidesCount",
  bus_night_rides: "busNightRides",
  bus_terminals: "busTerminals",
  bus_km: "busKm",
  bus_countries: "busCountries",
  bus_cross_border: "busCrossBorderRides",
  bus_operators: "busOperators",
  bus_longest_km: "busLongestKm",
};

export const BUS_REQUIREMENT_TYPES: readonly string[] = Object.keys(MEASURE);

/** The badge's progress, or `null` when it is not a bus badge. */
export function checkBusAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: BusAchievementStats
): { isUnlocked: boolean; progress: number } | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  // Rounded like rail's: a kilometre figure is shown whole, and the badge and
  // the list of its rides must not sit one km apart on every .5.
  const progress = Math.round(stats[key]);
  return { isUnlocked: progress >= achievement.requirement, progress };
}
