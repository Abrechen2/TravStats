/**
 * Log Retention Scheduler
 *
 * Runs `enforceLogRetention` daily and once at start, so the retention the
 * admin page promises is actually kept — it used to run only when someone
 * pressed "clean up" (audit 2026-09-26: 69 files back five months under a
 * seven-day setting on the beta).
 *
 * 03:45 UTC: after the 03:20 place-address backfill, before the 04:10
 * data-quality sweep (the slot table is in dataQualitySweepScheduler.ts), and
 * well clear of midnight, when the daily rotation writes the files this sweep
 * judges. Both containers run `TZ=UTC`.
 */

import cron from "node-cron";

import { enforceLogRetention } from "../services/logRetention";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "45 3 * * *";

let schedulerTask: cron.ScheduledTask | null = null;

export async function runLogRetention(): Promise<void> {
  try {
    await enforceLogRetention();
  } catch (error) {
    // Retried by the next run; it must not take the process down.
    logger.warn({ operation: "log_retention_failed", error });
  }
}

export function startLogRetentionScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runLogRetention();
    },
    { timezone: schedulerZone("logRetention") }
  );
  void runLogRetention();
  logger.info({ operation: "log_retention_scheduler_started", cron: CRON_EXPRESSION });
}

export function stopLogRetentionScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
