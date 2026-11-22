/**
 * Change-history retention (spec 2026-11-22-change-history §Retention).
 *
 * Runs only when `CHANGE_HISTORY_RETENTION_DAYS` is set: the default keeps
 * every row. 03:58 UTC, after the sync and TravTrack sweeps (slot table in
 * dataQualitySweepScheduler.ts). A misconfigured value is logged as an error
 * at start, and nothing is deleted.
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { changeHistoryRetentionDays, pruneChangeHistory } from "../services/changeLedger/retention";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "58 3 * * *";

let schedulerTask: ScheduledTask | null = null;

export async function runChangeHistoryRetention(days: number): Promise<void> {
  try {
    const deleted = await pruneChangeHistory(days);
    logger.info({ operation: "change_history_retention_done", context: { days, deleted } });
  } catch (error) {
    logger.warn({ operation: "change_history_retention_failed", error });
  }
}

export function startChangeHistoryRetentionScheduler(): void {
  if (schedulerTask) return;
  let days: number | null;
  try {
    days = changeHistoryRetentionDays();
  } catch (error) {
    logger.error({
      operation: "change_history_retention_misconfigured",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (days === null) return;
  const horizon = days;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runChangeHistoryRetention(horizon);
    },
    { timezone: schedulerZone("changeHistoryRetention") }
  );
  logger.info({
    operation: "change_history_retention_scheduler_started",
    context: { cron: CRON_EXPRESSION, days: horizon },
  });
}

export function stopChangeHistoryRetentionScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
