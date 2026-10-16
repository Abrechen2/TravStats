import { prisma } from "../db";
import type { Achievement } from "../prisma";
import { countableFerryWhere } from "../shared/ferryCounting";
import { isNightBusRide, terminalsOf } from "../shared/busRideKinds";

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
 * Hidden with the `ferryDomain` beta gate off: `services/achievementVisibility`
 * drops every `domain: "ferry"` badge from lists, counts and points then.
 */

export interface FerryAchievementStats {
  ferryCrossingsCount: number;
  ferryNightCrossings: number;
  ferryPorts: number;
}

const FERRY_BADGE_SELECT = {
  id: true,
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
function loadFerryBadgeRows(userId: string) {
  return prisma.ferryJourney.findMany({
    where: { userId, ...countableFerryWhere() },
    select: FERRY_BADGE_SELECT,
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
  });
}

type FerryBadgeRow = Awaited<ReturnType<typeof loadFerryBadgeRows>>[number];

export function foldFerryAchievementStats(rows: readonly FerryBadgeRow[]): FerryAchievementStats {
  return {
    ferryCrossingsCount: rows.length,
    ferryNightCrossings: rows.filter(isNightBusRide).length,
    ferryPorts: terminalsOf(rows).registry.size,
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
};

export const FERRY_REQUIREMENT_TYPES: readonly string[] = Object.keys(MEASURE);

/** The badge's progress, or `null` when it is not a ferry badge. */
export function checkFerryAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: FerryAchievementStats
): { isUnlocked: boolean; progress: number } | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  const progress = stats[key];
  return { isUnlocked: progress >= achievement.requirement, progress };
}
