import { prisma } from "../db";
import type { Achievement } from "../prisma";
import { MONTHS_BIT } from "../services/travtrack/dirtyDays";
import { providerIs } from "../services/locationProvider/provider";
import { SKIP, type BadgeVerdict } from "./badgeSource";

/**
 * The TravTrack badges (forgejo#400): days recorded and ground kilometres,
 * summed from the monthly values (`travtrack_month_values`) the privacy-safe
 * projection writes — the one counting home for both figures, and never a
 * fix a privacy zone hides. The days are the projection's UTC days.
 *
 * Abstention: when TravTrack is not this account's working location source
 * (off, unavailable, another provider) the answer is `SKIP`, never a progress
 * of 0 — a zero would revoke an earned badge because a switch was flipped.
 * `achievementVisibility` keeps the badges out of every list meanwhile.
 */

export interface TravTrackAchievementStats {
  /** TravTrack is the working source AND no month is owed to the projection; else the badges `SKIP`. */
  active: boolean;
  groundKm: number;
  daysRecorded: number;
}

export async function calculateTravTrackAchievementStats(
  userId: string
): Promise<TravTrackAchievementStats> {
  if (!(await providerIs(userId, "travtrack"))) {
    return { active: false, groundKm: 0, daysRecorded: 0 };
  }
  // A history edit (a new privacy zone, a deleted span) deletes the affected
  // monthly rows until the projection rebuilds them: summing then would read a
  // dip and revoke a badge. While any month is owed the answer is `SKIP`.
  const owed = await prisma.$queryRaw<{ hit: number }[]>`
    SELECT 1 AS hit FROM travtrack_dirty_days
     WHERE user_id = ${userId} AND (done & ${MONTHS_BIT}) = 0 LIMIT 1`;
  if (owed.length > 0) return { active: false, groundKm: 0, daysRecorded: 0 };
  const sum = await prisma.travTrackMonthValue.aggregate({
    where: { userId },
    _sum: { kmGround: true, daysWithData: true },
  });
  return {
    active: true,
    groundKm: sum._sum.kmGround ?? 0,
    daysRecorded: sum._sum.daysWithData ?? 0,
  };
}

const MEASURE: Record<string, (s: TravTrackAchievementStats) => number> = {
  travtrack_days: (s) => s.daysRecorded,
  travtrack_ground_km: (s) => Math.floor(s.groundKm),
};

export const TRAVTRACK_REQUIREMENT_TYPES: readonly string[] = Object.keys(MEASURE);

/** The badge's progress, `SKIP` while TravTrack is not in use, or `null` when it is not a TravTrack badge. */
export function checkTravTrackAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: TravTrackAchievementStats
): BadgeVerdict | null {
  const measure = MEASURE[achievement.requirementType];
  if (!measure) return null;
  if (!stats.active) return SKIP;
  const progress = measure(stats);
  return { isUnlocked: progress >= achievement.requirement, progress };
}
