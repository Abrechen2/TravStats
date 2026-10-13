/**
 * Flight Update Scheduler
 *
 * Scheduled job that periodically checks for active flights and creates pending updates.
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { checkAndUpdateAllFlights } from "../services/flightAutoUpdate";
import { cleanupExpiredUpdates } from "../services/pendingUpdateService";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

let schedulerRunning = false;
let schedulerTask: ScheduledTask | null = null;
type UpdateResult = { updatesCreated: number; expiredCount: number };
let activeUpdate: Promise<UpdateResult> | null = null;

/** Cron and manual requests share one complete run, including cleanup. */
function runUpdateCheck(): Promise<UpdateResult> {
  if (activeUpdate) return activeUpdate;
  // Defer work until after the shared promise is installed, including sync throws.
  activeUpdate = Promise.resolve()
    .then(async () => {
      const updatesCreated = await checkAndUpdateAllFlights();
      const expiredCount = await cleanupExpiredUpdates();
      return { updatesCreated, expiredCount };
    })
    .finally(() => {
      activeUpdate = null;
    });
  return activeUpdate;
}

/**
 * Start the flight update scheduler
 */
export function startFlightUpdateScheduler(intervalMinutes: number = 15): void {
  if (schedulerRunning) {
    logger.warn({
      operation: "start_scheduler",
      message: "Scheduler is already running",
    });
    return;
  }

  // Convert minutes to cron expression (every X minutes)
  const cronExpression = `*/${intervalMinutes} * * * *`;

  logger.info({
    operation: "start_scheduler",
    message: "Starting flight update scheduler",
    context: {
      intervalMinutes,
      cronExpression,
    },
  });

  schedulerTask = cron.schedule(
    cronExpression,
    async () => {
      try {
        logger.info({
          operation: "scheduler_run",
          message: "Running scheduled flight update check",
        });

        const { updatesCreated, expiredCount } = await runUpdateCheck();

        logger.info({
          operation: "scheduler_run_complete",
          message: "Scheduled flight update check completed",
          context: {
            updatesCreated,
            expiredCount,
          },
        });
      } catch (error) {
        logger.error({
          operation: "scheduler_run_error",
          message: "Error during scheduled flight update check",
          error: {
            message: error instanceof Error ? error.message : "Unknown error",
            stack: error instanceof Error ? error.stack : undefined,
          },
        });
      }
    },
    { timezone: schedulerZone("flightUpdate") }
  );

  schedulerRunning = true;
}

/**
 * Stop the flight update scheduler
 */
export function stopFlightUpdateScheduler(): void {
  if (!schedulerRunning || !schedulerTask) {
    return;
  }

  logger.info({
    operation: "stop_scheduler",
    message: "Stopping flight update scheduler",
  });

  schedulerTask.stop();
  schedulerTask = null;
  schedulerRunning = false;
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return schedulerRunning;
}

/**
 * Run the update check manually (for testing or immediate execution)
 */
export async function runManualUpdateCheck(): Promise<{
  updatesCreated: number;
  expiredCount: number;
}> {
  logger.info({
    operation: "manual_update_check",
    message: "Running manual flight update check",
  });

  return runUpdateCheck();
}
