/**
 * Account deletion recovery (forgejo#415): settles a deletion a crash left
 * between its reservation and its delete — once at start, then every ten
 * minutes. See `recoverStalledDeletions`.
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import logger from "../utils/logger";
import { recoverStalledDeletions } from "../services/account/removeAccount";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "*/10 * * * *";

let schedulerTask: ScheduledTask | null = null;

async function pass(): Promise<void> {
  try {
    const run = await recoverStalledDeletions();
    if (run.completed + run.restored > 0)
      logger.warn(
        { operation: "account_deletion_recovery", ...run },
        "Settled interrupted deletions"
      );
  } catch (error) {
    logger.error(
      { operation: "account_deletion_recovery_error", error },
      "Deletion recovery failed"
    );
  }
}

export function startAccountDeletionRecoveryScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(CRON_EXPRESSION, pass, {
    timezone: schedulerZone("accountDeletionRecovery"),
  });
  void pass();
}

export function stopAccountDeletionRecoveryScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
