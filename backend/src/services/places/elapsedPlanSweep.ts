/**
 * Persist `visited = true` on places whose planned visit has come due.
 *
 * A visit write promotes its place only when the visit has already happened,
 * so a plan made ahead of a trip left the place on the wishlist once the date
 * passed (tester feedback, 2026-11-08). Reads answer through
 * `isEffectivelyVisited` at once; this sweep makes the stored flag agree, which
 * is what the Prisma `where visited = true` readers and the achievement engine
 * see.
 *
 * It is NOT `visitedFlagBackfill`, which leaves elapsed plans out on purpose —
 * a one-off repair must not guess. The guards of `hasElapsedPlan` (curated
 * checklist rows, a place written after the plan came due = an explicit unmark)
 * are what make guessing safe here. Idempotent: a promoted place is no longer a
 * candidate, and the write is guarded by `visited = false`.
 */
import { prisma } from "../../db";
import { hasElapsedPlan } from "../../shared/placeCounting";
import { now as clockNow } from "../../shared/time/clock";
import { recheckAchievements } from "../../utils/achievements";
import logger from "../../utils/logger";

export interface ElapsedPlanSweepResult {
  scanned: number;
  promoted: number;
}

export async function sweepElapsedPlannedVisits(
  now: Date = clockNow()
): Promise<ElapsedPlanSweepResult> {
  const places = await prisma.place.findMany({
    where: { visited: false, curatedItemId: null, visits: { some: {} } },
    select: {
      id: true,
      userId: true,
      visited: true,
      curatedItemId: true,
      updatedAt: true,
      visits: {
        select: { visitedAt: true, visitedAtUtc: true, visitedZone: true, createdAt: true },
      },
    },
  });
  const due = places.filter((p) => hasElapsedPlan(p, p.visits, now));
  if (due.length === 0) return { scanned: places.length, promoted: 0 };

  // One guarded write per place: the row must still be the one that was read, so
  // an unmark or edit that landed since is not overwritten.
  let promoted = 0;
  for (const p of due) {
    const written = await prisma.place.updateMany({
      where: { id: p.id, visited: false, curatedItemId: null, updatedAt: p.updatedAt },
      data: { visited: true },
    });
    promoted += written.count;
  }
  for (const userId of new Set(due.map((p) => p.userId))) {
    try {
      await recheckAchievements(userId, "elapsed planned visit");
    } catch (error) {
      logger.warn({ operation: "elapsed_plan_recheck_error", userId, error }, "Recheck failed");
    }
  }
  logger.info(
    { operation: "elapsed_plan_sweep", scanned: places.length, promoted },
    "Elapsed planned visits promoted"
  );
  return { scanned: places.length, promoted };
}
