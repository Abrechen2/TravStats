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

import { prisma } from "../db";
import {
  checkRoadtripAchievement,
  EMPTY_ROADTRIP_STATS,
  type RoadtripAchievementStats,
} from "./roadtripAchievements";
import type { Achievement, UserAchievement } from "../prisma";
import logger from "./logger";
import { checkAchievement } from "./achievementChecks";
import { isAchievementHeld } from "./achievementHeld";
import type { FlightData, UserStats } from "./achievementStats";

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
  // `hadUnlockDate` says the snapshot already carried an `unlockedAt`. It is
  // what decides whether this write stamps one, and it is NOT the same question
  // as `wasUnlocked` (which reads the measure, and is what held-ness means
  // since the owner's ruling of 2026-09-20). The two come apart in both
  // directions: a badge whose measure has fallen keeps its date while ceasing
  // to be held, and a badge earned before the column meant anything meets its
  // requirement without carrying a date. Carried on the write rather than
  // re-derived at apply time because the snapshot is not in scope there.
  | {
      kind: "unlock";
      achievementId: string;
      requirement: number;
      wasUnlocked: boolean;
      hadUnlockDate: boolean;
    }
  | { kind: "progress"; rowId: string; progress: number }
  | { kind: "track"; achievementId: string; progress: number };

export interface AchievementWritePlan {
  writes: PlannedWrite[];
  /** Codes of badges the user has just STOPPED holding: the measure was at or
   *  above the requirement in the snapshot and is not any more. The row keeps
   *  its `unlockedAt`; what it loses is the badge and its points (owner's
   *  ruling, 2026-09-20). Reported so a support question about a total that
   *  dropped has an answer in the log. */
  belowRequirement: string[];
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
  /** Roadtrip measures (2.7) — their badges are checked by their own module. */
  roadtripStats: RoadtripAchievementStats = EMPTY_ROADTRIP_STATS
): AchievementWritePlan {
  const writes: PlannedWrite[] = [];
  const belowRequirement: string[] = [];

  for (const achievement of allAchievements) {
    const existing = existingAchievementMap.get(achievement.id);
    const wasUnlocked = Boolean(existing && existing.progress >= achievement.requirement);
    const hadUnlockDate = Boolean(existing?.unlockedAt);
    // Held is the live measure — see `achievementHeld.ts`, and the owner's
    // ruling of 2026-09-20 behind it. Read through that function rather than
    // reusing `wasUnlocked`, which happens to compute the same thing today:
    // the rule has one home, and this is a caller of it, not a copy.
    const wasHeld = isAchievementHeld(existing, achievement.requirement);

    // Every achievement is re-evaluated on every run, held ones included. It
    // used to `continue` on an already-unlocked one, so the MEASURE behind a
    // badge could never be corrected: a scoring bug (the Arctic classified as
    // Antarctica, say) went on showing its inflated number long after the bug
    // was fixed, and a progress bar that had lost its flights stayed full.
    //
    // Re-evaluation may change the number, and through it the badge: the
    // owner's ruling of 2026-09-20 is that held-ness follows the live data, so
    // a measure that falls below its requirement costs the badge and its
    // points. What re-evaluation may NOT change is the record of when the
    // requirement was first met — `unlockedAt` is a historical fact and is
    // never cleared or overwritten, which is how the page can explain the drop
    // instead of letting a total fall in silence.
    const { isUnlocked, progress } =
      checkRoadtripAchievement(achievement, roadtripStats) ??
      checkAchievement(achievement, stats, flights);

    if (isUnlocked) {
      // Steady state: the user already holds it, the stored progress is already
      // the requirement, and the date is on the row. Re-evaluating is cheap (in
      // memory), but writing is not — without this guard every flight save would
      // re-upsert every badge the user has ever earned. `hadUnlockDate` is part
      // of the condition so a row that meets its requirement without a date gets
      // one written exactly once, instead of being skipped forever.
      if (
        wasUnlocked &&
        hadUnlockDate &&
        existing &&
        existing.progress === achievement.requirement
      ) {
        continue;
      }
      writes.push({
        kind: "unlock",
        achievementId: achievement.id,
        requirement: achievement.requirement,
        wasUnlocked,
        hadUnlockDate,
      });
    } else if (existing) {
      // Nothing changed — skip the write. (A badge still meeting its
      // requirement never reaches here; this is the progress-row steady state.)
      if (existing.progress === progress) {
        continue;
      }
      if (wasHeld) {
        // The user held this badge and the measure no longer reaches its
        // requirement, so from this write on they do not hold it. That IS the
        // owner's ruling of 2026-09-20 — "Löschen löscht auch Punkte, der
        // Live-Stand wird gezählt" — and it needs no write of its own, because
        // held-ness is read off the very number this row is about to carry.
        //
        // What the write below must not do is touch `unlockedAt`. It used to
        // clear it. The 2026-09-19 integrity audit restored the 2.6.2 prod
        // mirror and booted it: `AWAY_SHARE_25`, earned 2026-09-03, came back
        // with progress 25 → 24 and `unlockedAt` NULL — not because the
        // traveller had done anything, but because `lodgingStats/rhythm.ts`
        // divides the current year by the days elapsed so far, so the share
        // falls on every night spent at home. The same boot on CT106 with
        // TZ=Europe/Berlin took `NOT_A_MORNING_PERSON` off two users and gave
        // it to a third, dated that day, because a process clock had moved.
        // The date is the one thing here a re-measurement cannot rebuild, and
        // it is what the card reads to say when the badge was last held.
        belowRequirement.push(achievement.code);
      }
      writes.push({
        kind: "progress",
        rowId: existing.id,
        progress,
      });
    } else if (progress > 0) {
      // Only create a progress row when there's something to track.
      writes.push({ kind: "track", achievementId: achievement.id, progress });
    }
  }

  return { writes, belowRequirement };
}

/**
 * Applies a plan and returns the achievements that were newly unlocked by it.
 * `achievementCount` is carried only for the error log — it says how big the
 * catalogue was, which is what tells a stuck run apart from a small one.
 */
export async function applyAchievementWrites(
  userId: string,
  plan: AchievementWritePlan,
  achievementCount: number
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
                // Keyed on the DATE, not on the measure: a row that meets its
                // requirement but carries no date was earned before the column
                // meant anything (or while the old revoke path was clearing it),
                // and this is where it gets one. A row that has a date keeps it
                // whatever the measure does — including a measure that fell and
                // came back, which is a return and not a first time. No other
                // write touches the column, and nothing clears it (owner's
                // ruling, 2026-09-20).
                ...(write.hadUnlockDate ? {} : { unlockedAt: new Date() }),
              },
              create: {
                userId,
                achievementId: write.achievementId,
                progress: write.requirement,
                unlockedAt: new Date(),
              },
              include: { achievement: true },
            });
            // Announced only when `unlockedAt` was null AND the measure was below
            // the requirement — a genuine first time. A badge whose measure
            // dipped and recovered already carries a date, so it returns to the
            // trophy case without a second popup: an achievement announces a
            // first time, not a return (owner's ruling, 2026-09-20). Stamping a
            // missing date on an old row that already met its requirement is
            // bookkeeping, and is silent for the same reason.
            if (!write.wasUnlocked && !write.hadUnlockDate) {
              newlyUnlocked.push(updated);
            }
          } else if (write.kind === "progress") {
            await tx.userAchievement.update({
              where: { id: write.rowId },
              data: {
                // `progress` only. The column that says the badge was earned is
                // never written here — not to clear it, and not to set it, which
                // would let a stale plan undo or invent a concurrent unlock.
                progress: write.progress,
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

    if (plan.belowRequirement.length > 0) {
      logger.info({
        operation: "achievements_below_requirement",
        message: "Achievements no longer held: their measure fell below the requirement",
        context: { userId, codes: plan.belowRequirement },
      });
    }
  } catch (error) {
    logger.error({
      operation: "update_achievements_transaction",
      message: "Failed to update achievements in transaction",
      context: { userId, achievementCount },
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error;
  }

  if (newlyUnlocked.length > 0) {
    logger.info({
      operation: "achievements_unlocked",
      message: `User unlocked ${newlyUnlocked.length} achievement(s)`,
      context: { userId, achievementIds: newlyUnlocked.map((ua) => ua.achievement.id) },
    });
  }

  return newlyUnlocked;
}
