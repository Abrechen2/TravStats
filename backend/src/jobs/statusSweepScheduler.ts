/**
 * Status Sweep Scheduler
 *
 * Hourly convergence sweep (see services/statusSweep.ts) that makes stored
 * temporal statuses agree with the dates — replaces the retired
 * transitionZombieFlights / transitionPastCruises one-way flips.
 */

import cron from "node-cron";
import logger from "../utils/logger";
import { sweepStatuses } from "../services/statusSweep";

const CRON_EXPRESSION = "0 * * * *";

let schedulerTask: cron.ScheduledTask | null = null;

export function startStatusSweepScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await sweepStatuses();
    } catch (error) {
      logger.warn(
        { operation: "status_sweep_error", error },
        "Hourly status sweep failed"
      );
    }
  });
  logger.info(
    { operation: "status_sweep_scheduler_started", cron: CRON_EXPRESSION },
    "status sweep scheduler started"
  );
}

export function stopStatusSweepScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
