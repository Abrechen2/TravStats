/**
 * Flight Update Scheduler
 * 
 * Scheduled job that periodically checks for active flights and creates pending updates.
 */

import cron from 'node-cron';
import { checkAndUpdateAllFlights } from '../services/flightAutoUpdate';
import { cleanupExpiredUpdates } from '../services/pendingUpdateService';
import logger from '../utils/logger';

let schedulerRunning = false;
let schedulerTask: cron.ScheduledTask | null = null;

/**
 * Start the flight update scheduler
 */
export function startFlightUpdateScheduler(intervalMinutes: number = 15): void {
  if (schedulerRunning) {
    logger.warn({
      operation: 'start_scheduler',
      message: 'Scheduler is already running',
    });
    return;
  }

  // Convert minutes to cron expression (every X minutes)
  const cronExpression = `*/${intervalMinutes} * * * *`;

  logger.info({
    operation: 'start_scheduler',
    message: 'Starting flight update scheduler',
    context: {
      intervalMinutes,
      cronExpression,
    },
  });

  schedulerTask = cron.schedule(cronExpression, async () => {
    try {
      logger.info({
        operation: 'scheduler_run',
        message: 'Running scheduled flight update check',
      });

      // Check and update flights
      const updatesCreated = await checkAndUpdateAllFlights();

      // Cleanup expired updates
      const expiredCount = await cleanupExpiredUpdates();

      logger.info({
        operation: 'scheduler_run_complete',
        message: 'Scheduled flight update check completed',
        context: {
          updatesCreated,
          expiredCount,
        },
      });
    } catch (error) {
      logger.error({
        operation: 'scheduler_run_error',
        message: 'Error during scheduled flight update check',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
    }
  });

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
    operation: 'stop_scheduler',
    message: 'Stopping flight update scheduler',
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
    operation: 'manual_update_check',
    message: 'Running manual flight update check',
  });

  const updatesCreated = await checkAndUpdateAllFlights();
  const expiredCount = await cleanupExpiredUpdates();

  return {
    updatesCreated,
    expiredCount,
  };
}




