/**
 * Resumes bulk re-routes (forgejo#436). A run that met the provider's daily
 * quota is `paused` with a cursor and a `resumeAfter` at the start of the next
 * UTC day; this hourly tick (and once at boot, which also picks up a run its
 * process died under) starts the next one. Which items are still to do is in
 * `services/tour/routing/rerouteRun.ts`.
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { resumeDueRerouteRuns } from "../services/tour/routing/rerouteRun";
import { schedulerZone } from "../shared/time/schedulerZone";
import logger from "../utils/logger";

const CRON_EXPRESSION = "10 * * * *";

let schedulerTask: ScheduledTask | null = null;

export async function runRerouteResume(): Promise<void> {
  try {
    await resumeDueRerouteRuns();
  } catch (error) {
    logger.warn(
      {
        operation: "reroute_resume_failed",
        message: error instanceof Error ? error.message : "unknown error",
      },
      "Re-route resume failed; the next hourly run retries"
    );
  }
}

export function startRerouteResumeScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runRerouteResume();
    },
    { timezone: schedulerZone("rerouteResume") }
  );
  void runRerouteResume();
}

export function stopRerouteResumeScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
