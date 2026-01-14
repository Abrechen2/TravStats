import cron from 'node-cron';
import { prisma } from '../db';
import logger from '../utils/logger';
import { createBackup } from './backupService';

let scheduledJob: cron.ScheduledTask | null = null;

/**
 * Get cron pattern for backup interval
 */
function getCronPattern(interval: 'daily' | 'weekly' | 'monthly'): string {
  switch (interval) {
    case 'daily':
      return '0 2 * * *'; // 2 AM daily
    case 'weekly':
      return '0 2 * * 0'; // 2 AM on Sunday
    case 'monthly':
      return '0 2 1 * *'; // 2 AM on 1st of month
    default:
      return '0 2 * * 0'; // Default to weekly
  }
}

/**
 * Check settings and run backup if needed
 */
async function checkAndRunBackup(): Promise<void> {
  try {
    // Get admin settings to check backup configuration
    // Note: Backup settings are stored in UserSettings for the admin user
    // For now, we'll check system-wide settings or use environment variables
    const autoBackup = process.env.AUTO_BACKUP_ENABLED === 'true';
    const backupInterval = (process.env.BACKUP_INTERVAL as 'daily' | 'weekly' | 'monthly') || 'weekly';

    if (!autoBackup) {
      logger.debug({
        operation: 'backup_scheduler_skip',
        message: 'Auto backup is disabled',
      });
      return;
    }

    // Check if there's already a running backup
    const runningBackup = await prisma.backup.findFirst({
      where: {
        status: 'running',
      },
    });

    if (runningBackup) {
      logger.warn({
        operation: 'backup_scheduler_skip',
        message: 'Backup already running, skipping scheduled backup',
        backupId: runningBackup.id,
      });
      return;
    }

    logger.info({
      operation: 'backup_scheduler_start',
      message: 'Starting scheduled backup',
      interval: backupInterval,
    });

    await createBackup({ type: 'full' });

    logger.info({
      operation: 'backup_scheduler_complete',
      message: 'Scheduled backup completed',
    });
  } catch (error) {
    logger.error({
      operation: 'backup_scheduler_error',
      message: 'Scheduled backup failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Start the backup scheduler
 */
export async function startScheduler(): Promise<void> {
  if (scheduledJob) {
    logger.warn({
      operation: 'backup_scheduler_already_running',
      message: 'Backup scheduler is already running',
    });
    return;
  }

  // Get settings from environment or default
  const autoBackup = process.env.AUTO_BACKUP_ENABLED === 'true';
  const backupInterval = (process.env.BACKUP_INTERVAL as 'daily' | 'weekly' | 'monthly') || 'weekly';

  if (!autoBackup) {
    logger.info({
      operation: 'backup_scheduler_disabled',
      message: 'Auto backup is disabled, scheduler not started',
    });
    return;
  }

  const cronPattern = getCronPattern(backupInterval);

  logger.info({
    operation: 'backup_scheduler_start',
    message: 'Starting backup scheduler',
    cronPattern,
    interval: backupInterval,
  });

  scheduledJob = cron.schedule(cronPattern, async () => {
    await checkAndRunBackup();
  });

  scheduledJob.start();

  logger.info({
    operation: 'backup_scheduler_started',
    message: 'Backup scheduler started successfully',
  });
}

/**
 * Stop the backup scheduler
 */
export function stopScheduler(): void {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
    logger.info({
      operation: 'backup_scheduler_stopped',
      message: 'Backup scheduler stopped',
    });
  }
}

/**
 * Update schedule based on settings
 */
export async function updateSchedule(): Promise<void> {
  stopScheduler();
  await startScheduler();
}

/**
 * Get current schedule status
 */
export function getScheduleStatus(): { running: boolean; cronPattern?: string; interval?: string } {
  if (!scheduledJob) {
    return { running: false };
  }

  const autoBackup = process.env.AUTO_BACKUP_ENABLED === 'true';
  const backupInterval = (process.env.BACKUP_INTERVAL as 'daily' | 'weekly' | 'monthly') || 'weekly';

  if (!autoBackup) {
    return { running: false };
  }

  return {
    running: true,
    cronPattern: getCronPattern(backupInterval),
    interval: backupInterval,
  };
}














