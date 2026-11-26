/**
 * Change-history retention (spec 2026-11-22-change-history §Retention): a
 * rolling window per account, 3/6/12/24 months, 12 by default (owner,
 * 2026-11-23). Runs nightly at 03:58 UTC, after the sync and TravTrack sweeps
 * (slot table in dataQualitySweepScheduler.ts); it deletes in bounded batches.
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { pruneChangeHistory } from "../services/changeLedger/retention";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";
import { runHeavyJob } from "../services/jobs/heavySlot";

const CRON_EXPRESSION = "58 3 * * *";

let schedulerTask: ScheduledTask | null = null;

export async function runChangeHistoryRetention(): Promise<void> {
  try {
    const deleted = await pruneChangeHistory();
    logger.info({ operation: "change_history_retention_done", context: { deleted } });
  } catch (error) {
    logger.warn({ operation: "change_history_retention_failed", error });
  }
}

export function startChangeHistoryRetentionScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runHeavyJob("changeHistoryRetention", () => runChangeHistoryRetention());
    },
    { timezone: schedulerZone("changeHistoryRetention") }
  );
  logger.info({
    operation: "change_history_retention_scheduler_started",
    context: { cron: CRON_EXPRESSION },
  });
}

export function stopChangeHistoryRetentionScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
