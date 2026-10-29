/**
 * TravTrack diagnostics retention (spec 2026-10-29-travtrack-diagnostics).
 *
 * The phone's diagnostics log lives 14 days: events by their instant, upload
 * receipts by arrival. Daily and once at start. 03:40 UTC, in the quiet
 * maintenance hour beside the other retention jobs (slot table in
 * dataQualitySweepScheduler.ts).
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { DIAGNOSTICS_RETENTION_DAYS } from "../schemas/travtrackDiagnostics";
import { pruneDiagnostics } from "../services/travtrack/diagnostics/ingest";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "40 3 * * *";

let schedulerTask: ScheduledTask | null = null;

export async function runTravTrackDiagnosticsRetention(): Promise<void> {
  try {
    const result = await pruneDiagnostics(DIAGNOSTICS_RETENTION_DAYS);
    logger.info({ operation: "travtrack_diagnostics_retention_done", ...result });
  } catch (error) {
    // Retried by the next run; until then the log is only older than promised.
    logger.warn({ operation: "travtrack_diagnostics_retention_failed", error });
  }
}

export function startTravTrackDiagnosticsRetentionScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runTravTrackDiagnosticsRetention();
    },
    { timezone: schedulerZone("travTrackDiagnosticsRetention") }
  );
  void runTravTrackDiagnosticsRetention();
  logger.info({
    operation: "travtrack_diagnostics_retention_scheduler_started",
    cron: CRON_EXPRESSION,
  });
}

export function stopTravTrackDiagnosticsRetentionScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
