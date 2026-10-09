import type { Achievement } from "../prisma";
import { isNightBusRide, terminalsOf } from "../shared/busRideKinds";
import { loadBusRows, type BusStatsRow } from "../services/bus/busStats";

/**
 * The bus badges (forgejo#263) — their measures and their check, beside the
 * rail and rental modules. Which rides count is `shared/busCounting.ts`
 * (completed only); what a night bus is and which terminal is which is
 * `shared/busRideKinds.ts`, the rules the bus tab reads, so a badge and the
 * tab cannot disagree.
 *
 * Hidden with the `busDomain` beta gate off: `services/achievementVisibility`
 * drops every `domain: "bus"` badge from lists, counts and points then.
 */

export interface BusAchievementStats {
  busRidesCount: number;
  busNightRides: number;
  busTerminals: number;
}

export function foldBusAchievementStats(rows: readonly BusStatsRow[]): BusAchievementStats {
  return {
    busRidesCount: rows.length,
    busNightRides: rows.filter(isNightBusRide).length,
    busTerminals: terminalsOf(rows).registry.size,
  };
}

export async function calculateBusAchievementStats(userId: string): Promise<BusAchievementStats> {
  return foldBusAchievementStats(await loadBusRows(userId));
}

const MEASURE: Record<string, keyof BusAchievementStats> = {
  bus_count: "busRidesCount",
  bus_night_rides: "busNightRides",
  bus_terminals: "busTerminals",
};

export const BUS_REQUIREMENT_TYPES: readonly string[] = Object.keys(MEASURE);

/** The badge's progress, or `null` when it is not a bus badge. */
export function checkBusAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: BusAchievementStats
): { isUnlocked: boolean; progress: number } | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  const progress = stats[key];
  return { isUnlocked: progress >= achievement.requirement, progress };
}
