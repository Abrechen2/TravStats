import { settleAchievementRechecks } from "./src/middleware/recheckInFlight";

/**
 * A recheck started by a write after its response must not outlive the test
 * that caused it — see `src/middleware/recheckInFlight.ts` for the deadlock
 * this prevents in teardown.
 */
afterEach(async () => {
  await settleAchievementRechecks();
});
