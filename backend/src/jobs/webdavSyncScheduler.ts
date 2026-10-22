/**
 * Per-account WebDAV sync scheduler (forgejo#321).
 *
 * 05:15 UTC: after the 04:55 photo-journey scan, outside the 02:00–04:40
 * maintenance slots (table in dataQualitySweepScheduler.ts), so an export is
 * not built while the backup or a sweep holds the database.
 *
 * Every enabled account whose schedule is due runs in turn — one at a time,
 * because each run builds a whole account's export in memory. "Due" reads
 * the last ATTEMPT, so a share that is down is retried on the account's
 * schedule, not hammered; each failure is recorded on the row and shown on
 * the settings page.
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { prisma } from "../db";
import { runWebdavSync } from "../services/webdavSync/runSync";
import { WebdavSyncError } from "../services/webdavSync/errors";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "15 5 * * *";

/** How long after an attempt the next one is due. Shorter than the period, so
 *  a run that started a few minutes late yesterday is still due today. */
export const DUE_AFTER_MS: Record<string, number> = {
  daily: 20 * 60 * 60_000,
  weekly: 6.5 * 24 * 60 * 60_000,
};

let schedulerTask: ScheduledTask | null = null;

/** The accounts whose sync is due at `now`. */
export async function dueWebdavSyncs(now: Date): Promise<string[]> {
  const rows = await prisma.userWebdavSync.findMany({
    where: { enabled: true },
    select: { userId: true, schedule: true, lastAttemptAt: true },
  });
  return rows
    .filter((r) => {
      if (!r.lastAttemptAt) return true;
      const gap = DUE_AFTER_MS[r.schedule] ?? DUE_AFTER_MS.daily;
      return now.getTime() - r.lastAttemptAt.getTime() >= gap;
    })
    .map((r) => r.userId);
}

export async function runDueWebdavSyncs(now: Date = new Date()): Promise<void> {
  let userIds: string[];
  try {
    userIds = await dueWebdavSyncs(now);
  } catch (error) {
    logger.warn({ operation: "webdav_user_sync_sweep_failed", error });
    return;
  }
  for (const userId of userIds) {
    try {
      await runWebdavSync(userId);
    } catch (error) {
      // Recorded on the row by runWebdavSync; the sweep goes on to the next.
      if (!(error instanceof WebdavSyncError)) {
        logger.warn({ operation: "webdav_user_sync_unexpected", userId, error });
      }
    }
  }
}

export function startWebdavSyncScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runDueWebdavSyncs();
    },
    { timezone: schedulerZone("webdavSync") }
  );
  logger.info({ operation: "webdav_user_sync_scheduler_started", cron: CRON_EXPRESSION });
}

export function stopWebdavSyncScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
