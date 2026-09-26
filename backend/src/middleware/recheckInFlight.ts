/**
 * The after-write achievement rechecks still running — a registry with no
 * imports, so a test harness can wait for them without loading the engine.
 *
 * `recheckAchievementsAfterWrite` answers first and rechecks after. A test
 * that writes a rail ride and then deletes its user in `afterAll` raced that
 * recheck: the user delete and the badge upsert took their locks in opposite
 * order and Postgres answered `40P01` on the teardown (measured 2026-09-26,
 * railDocuments and railLookup). `jest.afterEnv.ts` waits here after each test.
 */
const inFlight = new Set<Promise<unknown>>();

export function trackRecheck(run: Promise<unknown>): void {
  inFlight.add(run);
  void run.finally(() => inFlight.delete(run));
}

/** Resolves once every recheck started so far has finished, however it ended. */
export async function settleAchievementRechecks(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}
