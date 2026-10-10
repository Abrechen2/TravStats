import { prisma } from "../db";
import { calculateRailAchievementStats } from "./railAchievements";
import { calculateInsightBadgeStats } from "./insightAchievements";
import { loadDomainAchievementChecks } from "./domainAchievementChecks";
import logger from "./logger";
import {
  applyAchievementWrites,
  planAchievementWrites,
  type UserAchievementWithRelation,
} from "./achievementWrites";
import type { FlightData } from "./achievementStats";
import { achievementCountries } from "./achievementCountries";
// Loading and folding the core measures live in `achievementInputs.ts`, so the
// badge evidence can fold subsets of the same rows (forgejo#265).
import { computeCoreStats, loadCoreInputs } from "./achievementInputs";

// Re-export the shared types so existing callers that imported them from
// `./achievements` keep compiling without touching every import site.
export type { FlightData, UserStats } from "./achievementStats";
export { calculateUserStats, getContinent } from "./achievementStats";
export { checkAchievement } from "./achievementChecks";

/**
 * The re-check currently running or queued for a user, if any.
 *
 * Forgejo #39. A run re-evaluates every achievement inside one long
 * transaction, and ten of the sixteen call sites do not await it — a place tick
 * answers 2xx and leaves the transaction going. Two of those for the same user
 * overlap readily: save a flight while a place tick is still running, or let the
 * six detached call sites in `places.ts` fire in quick succession.
 *
 * The overlap is not theoretical. The suite showed both halves of it — an
 * `upsert` on `(user_id, achievement_id)` failing the unique constraint, and a
 * `40P01 deadlock detected` between two of these transactions. `upsert` is not
 * enough on its own: when the conflicting row belongs to a transaction that has
 * not committed, the second statement blocks and can still fail.
 *
 * So runs for one user are chained end to end. Different users are untouched and
 * still run concurrently — the contention is per user, and so is the fix;
 * serialising everyone would turn one slow account into a queue for the whole
 * instance.
 *
 * The chain is per PROCESS. A deployment running several instances against one
 * database would still overlap; TravStats ships as a single container, so this
 * holds for how it is actually run, and a second instance would need the lock in
 * the database instead. Written down because that limit is invisible from here.
 */
const runningPerUser = new Map<string, Promise<UserAchievementWithRelation[]>>();

export interface AchievementCheckOptions {
  /**
   * The date a badge first unlocked by THIS run is stamped with. Every live
   * caller leaves it out: a badge earned by a save is earned now. Only the
   * demo seed passes it, replaying its trips in order and stamping each badge
   * with the day of the trip that earned it (`seedDemoAccount.ts`) — a seed
   * writes ten years in half a minute, and "unlocked on the seed day" for
   * every badge was the tell (board item realistic-demo-account (c)). It
   * never moves a date a row already carries.
   */
  unlockedAt?: Date;
}

/**
 * Check and update achievements for a user
 * Returns newly unlocked achievements
 * Uses transactions to prevent race conditions and ensure data consistency
 *
 * Serialised per user — see `runningPerUser`. A caller still gets its own result
 * and its own rejection; it may simply wait for a run already under way.
 */
export function checkAndUpdateAchievements(
  userId: string,
  options: AchievementCheckOptions = {}
): Promise<UserAchievementWithRelation[]> {
  const previous = runningPerUser.get(userId);
  const run = () => runAchievementCheck(userId, options.unlockedAt ?? new Date());

  // Both branches run the check: a failed run must not stop the queue behind it.
  const started: Promise<UserAchievementWithRelation[]> = previous
    ? previous.then(run, run)
    : run();

  // Only clear the slot if nothing newer has taken it, or a later caller's run
  // would drop out of the chain and could overlap after all.
  const tracked: Promise<UserAchievementWithRelation[]> = started.finally(() => {
    if (runningPerUser.get(userId) === tracked) runningPerUser.delete(userId);
  });

  runningPerUser.set(userId, tracked);
  return tracked;
}

/**
 * Run a re-check as part of the request, and never let it fail the request.
 *
 * Forgejo #39. These ten call sites used to detach: `.catch(...)` and carry on,
 * so the work outlived the response. Two things came of that. The transaction
 * raced whatever else touched the user — a `40P01 deadlock` against a delete —
 * and a re-check could still be writing to rows that had since been removed,
 * which is what `Record to update not found` in the logs was.
 *
 * Shrinking the transaction (see `runningPerUser` above) removed the deadlock,
 * because the run no longer holds locks across the whole catalogue. Awaiting
 * removes the rest: the work cannot outlive the request that caused it. The
 * latency this now adds is small for the same reason — in the ordinary case the
 * plan is empty and no transaction is opened at all.
 *
 * The error is still swallowed rather than raised. The write the user asked for
 * has already succeeded by this point; failing their request because a badge
 * could not be recomputed would be the wrong trade. It stays a log line, and
 * that limit is the part of #39 that remains open: a lost badge appears to the
 * user one save later rather than as an error.
 */
export async function recheckAchievements(userId: string, after: string): Promise<void> {
  try {
    await checkAndUpdateAchievements(userId);
  } catch (error) {
    logger.error({ error, userId, context: { after } }, "[Achievements] Re-check failed");
  }
}

async function runAchievementCheck(
  userId: string,
  unlockedAt: Date
): Promise<UserAchievementWithRelation[]> {
  try {
    // Get all achievements
    const allAchievements = await prisma.achievement.findMany();

    // Fetch user-level context we need for a few of the new achievements
    // (Birthday Flight needs month+day of birthdate).

    // Get user's existing achievements
    const existingAchievements = await prisma.userAchievement.findMany({
      where: { userId },
    });

    const existingAchievementMap = new Map(
      existingAchievements.map((ua) => [ua.achievementId, ua])
    );

    const inputs = await loadCoreInputs(userId);
    const { flights, cruises } = inputs;
    // Rental, bus and the cross-domain trip badges (forgejo#262/#263/#265).
    const domainBadges = await loadDomainAchievementChecks(userId);
    const {
      stats: augmentedStats,
      cruiseStatsInput,
      userBirthday,
    } = await computeCoreStats(inputs, {
      // The badge set counts like the passport — `achievementCountries` holds
      // the rule and says why; the union is its floor.
      countries: (unionFloor) => achievementCountries(userId, unionFloor),
      tripsFullyDocumented: domainBadges.crossDomain?.tripsFullyDocumented ?? 0,
    });

    // Decide first, write second — the plan is a value that exists before any
    // transaction opens. See `./achievementWrites` for why that ordering is the
    // fix for forgejo#39 and not merely tidier.
    // Roadtrip and statistics-expansion measures: each source read once, a
    // failing one skipped rather than aborting the whole check
    // (`insightAchievements.ts`, `badgeSource.ts`). The flight and cruise rows
    // loaded above are handed over, not read again.
    const { roadtripStats, insightStats } = await calculateInsightBadgeStats(userId, {
      flights,
      cruises: cruises.map((c, i) => ({ id: c.id, input: cruiseStatsInput[i], stops: c.stops })),
      userBirthday,
    });
    const plan = planAchievementWrites(
      allAchievements,
      existingAchievementMap,
      augmentedStats,
      flights as FlightData[],
      roadtripStats,
      await calculateRailAchievementStats(userId),
      insightStats,
      domainBadges.checks
    );

    // `return await`, not `return`: a bare return would hand the promise out
    // past the catch below, and a failed write would stop being logged here.
    return await applyAchievementWrites(userId, plan, allAchievements.length, unlockedAt);
  } catch (error) {
    logger.error({
      operation: "check_and_update_achievements",
      message: "Failed to check and update achievements",
      context: { userId },
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    // Re-throw to allow caller to handle
    throw error;
  }
}
