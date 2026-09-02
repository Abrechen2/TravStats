// Owns one question: given a user's measures, what does a re-check actually
// WRITE — and how does it write it without deadlocking?
//
// The seam is one `achievements.ts` already drew for itself and then did not
// follow: "deciding first and writing second". Deciding is pure, in-memory work
// over the whole catalogue; writing is a transaction over the handful of rows
// that genuinely changed. They were interleaved in one function, which is
// precisely how the transaction came to wrap the decision and hold locks across
// ~259 achievements on every save in every domain (forgejo#39). Keeping the two
// halves in separate functions makes it hard to put back: the plan is a value
// that exists before the transaction opens, and there is nowhere to smuggle a
// query into the loop that builds it.
//
// `achievements.ts` keeps the other job — loading a user's rows and folding
// them into the measures. That one talks to eight tables; this one talks to
// exactly one.

import { prisma } from '../db';
import type { Achievement, UserAchievement } from '@prisma/client';
import logger from './logger';
import { checkAchievement } from './achievementChecks';
import type { FlightData, UserStats } from './achievementStats';

export type UserAchievementWithRelation = UserAchievement & { achievement: Achievement };

/**
 * What a run will actually write, decided before a transaction is opened.
 *
 * Forgejo #39. The transaction used to wrap the whole planning loop — all ~259
 * achievements, including `checkAchievement`, which is pure in-memory work
 * and touches no database. So a transaction stayed open across the entire
 * catalogue while holding the locks its earlier writes had taken, on every
 * save in every domain. In the ordinary case it wrote almost nothing and
 * held that open anyway: the steady-state guards below skip a badge whose
 * stored value already matches.
 *
 * That is what produced `40P01 deadlock detected` against an unrelated
 * statement touching the same user — a test's teardown in the reported case,
 * and in production anyone deleting their account while a re-check runs.
 *
 * Deciding first and writing second makes the transaction as long as the
 * number of rows that genuinely change, instead of as long as the catalogue.
 * When nothing changed there is NO transaction at all, and nothing to
 * collide with. It also makes awaiting these calls affordable, which is the
 * other half of #39.
 *
 * No guarantee is weakened. `existingAchievementMap` was already read before
 * the transaction — that staleness is exactly why the writes below are
 * `upsert` and not `create` — so the decision was never protected by it.
 */
type PlannedWrite =
  | { kind: "unlock"; achievementId: string; requirement: number; wasUnlocked: boolean }
  // `revoking` says the row is being written DOWN through its requirement, and
  // is what clears `unlockedAt`. Carried on the write rather than re-derived at
  // apply time because the comparison needs the requirement and the snapshot,
  // and neither is in scope there — the plan is where that is known.
  | { kind: "progress"; rowId: string; progress: number; revoking: boolean }
  | { kind: "track"; achievementId: string; progress: number };

export interface AchievementWritePlan {
  writes: PlannedWrite[];
  /** Codes of badges the user holds but no longer meets — logged after the
   *  write succeeds, because "revoked" only becomes true once it is stored. */
  revoked: string[];
}

/**
 * Evaluates the whole catalogue against a user's measures and returns the rows
 * that would change. Pure: it reads no database and writes nothing.
 */
export function planAchievementWrites(
  allAchievements: Achievement[],
  existingAchievementMap: Map<string, UserAchievement>,
  stats: UserStats,
  flights: FlightData[],
): AchievementWritePlan {
  const writes: PlannedWrite[] = [];
  const revoked: string[] = [];

  for (const achievement of allAchievements) {
    const existing = existingAchievementMap.get(achievement.id);
    const wasUnlocked = Boolean(existing && existing.progress >= achievement.requirement);

    // Every achievement is re-evaluated on every run, unlocked ones included.
    // This used to `continue` on an already-unlocked achievement, which meant a
    // badge granted from data that was later corrected or deleted could never be
    // taken back. It also meant a scoring bug (the Arctic being classified as
    // Antarctica, say) stayed rewarded forever even after the bug was fixed.
    const { isUnlocked, progress } = checkAchievement(achievement, stats, flights);

    if (isUnlocked) {
      // Steady state: the user already holds it and the stored progress is
      // already the requirement. Re-evaluating is cheap (in memory), but writing
      // is not — without this guard every flight save would re-upsert every badge
      // the user has ever earned.
      if (wasUnlocked && existing && existing.progress === achievement.requirement) {
        continue;
      }
      writes.push({
        kind: "unlock",
        achievementId: achievement.id,
        requirement: achievement.requirement,
        wasUnlocked,
      });
    } else if (existing) {
      // Nothing changed — skip the write. (An unlocked badge that is still
      // unlocked never reaches here; this is the progress-row steady state.)
      if (existing.progress === progress) {
        continue;
      }
      if (wasUnlocked) {
        // The user holds this badge but no longer meets its requirement — the
        // flights behind it were deleted, or it was granted by a scoring bug.
        // Writing the true progress drops it back below the threshold, which is
        // what "revoked" means here: held-ness is derived from
        // `progress >= requirement` everywhere, so there is no flag to clear.
        // `unlockedAt` is cleared alongside it, so the ROW says so too and not
        // only this log line.
        revoked.push(achievement.code);
      }
      writes.push({
        kind: "progress",
        rowId: existing.id,
        progress,
        revoking: wasUnlocked,
      });
    } else if (progress > 0) {
      // Only create a progress row when there's something to track.
      writes.push({ kind: "track", achievementId: achievement.id, progress });
    }
  }

  return { writes, revoked };
}

/**
 * Applies a plan and returns the achievements that were newly unlocked by it.
 * `achievementCount` is carried only for the error log — it says how big the
 * catalogue was, which is what tells a stuck run apart from a small one.
 */
export async function applyAchievementWrites(
  userId: string,
  plan: AchievementWritePlan,
  achievementCount: number,
): Promise<UserAchievementWithRelation[]> {
  const newlyUnlocked: UserAchievementWithRelation[] = [];

  try {
    // The common case: nothing to write, so no transaction is opened and this
    // run takes no locks at all.
    if (plan.writes.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const write of plan.writes) {
          // `upsert`, not `create`: the snapshot this plan was built from is
          // older than the transaction, so a concurrent invocation may have
          // inserted the same (user, achievement) pair in between and would
          // otherwise trip the unique constraint.
          if (write.kind === "unlock") {
            const updated = await tx.userAchievement.upsert({
              where: {
                userId_achievementId: { userId, achievementId: write.achievementId },
              },
              update: {
                progress: write.requirement,
                // Keep the ORIGINAL unlock date. Re-checking an achievement the user
                // already holds must not make it look freshly earned — that would
                // reshuffle the trophy case on every flight they add.
                //
                // The other branch is the only place a date is ever set: a badge
                // being earned, now or again after a revocation cleared the old
                // one. Every other write leaves the column null.
                ...(write.wasUnlocked ? {} : { unlockedAt: new Date() }),
              },
              create: {
                userId,
                achievementId: write.achievementId,
                progress: write.requirement,
                unlockedAt: new Date(),
              },
              include: { achievement: true },
            });
            // Only count as newly-unlocked when the snapshot had no unlock yet.
            // Re-upserting an already-unlocked row shouldn't emit another event.
            if (!write.wasUnlocked) {
              newlyUnlocked.push(updated);
            }
          } else if (write.kind === "progress") {
            await tx.userAchievement.update({
              where: { id: write.rowId },
              data: {
                progress: write.progress,
                // A revocation clears the date; an ordinary progress tick on a
                // badge that was never held has nothing to clear and must not
                // write the column at all, or a concurrent unlock could be
                // undone by a stale plan.
                ...(write.revoking ? { unlockedAt: null } : {}),
              },
            });
          } else {
            await tx.userAchievement.upsert({
              where: {
                userId_achievementId: { userId, achievementId: write.achievementId },
              },
              update: { progress: write.progress },
              create: {
                userId,
                achievementId: write.achievementId,
                progress: write.progress,
              },
            });
          }
        }
      });
    }

    if (plan.revoked.length > 0) {
      logger.info({
        operation: 'revoke_achievements',
        message: 'Achievements no longer met their requirement and were revoked',
        context: { userId, codes: plan.revoked },
      });
    }
  } catch (error) {
    logger.error({
      operation: 'update_achievements_transaction',
      message: 'Failed to update achievements in transaction',
      context: { userId, achievementCount },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error;
  }

  if (newlyUnlocked.length > 0) {
    logger.info({
      operation: 'achievements_unlocked',
      message: `User unlocked ${newlyUnlocked.length} achievement(s)`,
      context: { userId, achievementIds: newlyUnlocked.map(ua => ua.achievement.id) },
    });
  }

  return newlyUnlocked;
}
