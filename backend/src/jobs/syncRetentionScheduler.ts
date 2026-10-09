/**
 * Sync Retention Scheduler (forgejo#141)
 *
 * Prunes `sync_changes` older than `SYNC_RETENTION_DAYS` daily and once at
 * start, and raises the feed's watermark so a cursor older than the horizon
 * is answered "resync required" instead of a feed with holes in it.
 *
 * 03:50 UTC: beside the 03:45 log retention, in the quiet maintenance hour,
 * before the 04:10 data-quality sweep (slot table in
 * dataQualitySweepScheduler.ts).
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { pruneSyncChanges } from "../services/sync/state";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "50 3 * * *";

let schedulerTask: ScheduledTask | null = null;

export async function runSyncRetention(): Promise<void> {
  try {
    const result = await pruneSyncChanges();
    logger.info({ operation: "sync_retention_done", ...result });
  } catch (error) {
    // Retried by the next run. Until then the table only grows; nothing a
    // phone reads is wrong, because the watermark only moves after a prune.
    logger.warn({ operation: "sync_retention_failed", error });
  }
}

export function startSyncRetentionScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runSyncRetention();
    },
    { timezone: schedulerZone("syncRetention") }
  );
  void runSyncRetention();
  logger.info({ operation: "sync_retention_scheduler_started", cron: CRON_EXPRESSION });
}

export function stopSyncRetentionScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
