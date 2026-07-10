import cron from "node-cron";
import logger from "../utils/logger";
import { usageStatsTick } from "../services/usageStats";

let scheduledJob: cron.ScheduledTask | null = null;

/** Random 0-59 minute offset so a thousand installs do not all ping at 03:00 UTC. */
function jitteredDailyPattern(): string {
  const minute = Math.floor(Math.random() * 60);
  return `${minute} 3 * * *`;
}

export function startUsageStatsScheduler(): void {
  if (scheduledJob) {
    logger.warn("usage-stats scheduler already running");
    return;
  }
  const pattern = jitteredDailyPattern();
  scheduledJob = cron.schedule(pattern, async () => {
    await usageStatsTick();
  });
  scheduledJob.start();
  logger.info({ pattern }, "usage-stats scheduler started");
}

export function stopUsageStatsScheduler(): void {
  if (!scheduledJob) return;
  scheduledJob.stop();
  scheduledJob = null;
  logger.info("usage-stats scheduler stopped");
}

export function isUsageStatsSchedulerRunning(): boolean {
  return scheduledJob !== null;
}
