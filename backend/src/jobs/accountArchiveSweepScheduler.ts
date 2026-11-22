/**
 * Account archive sweep (forgejo#433): finished account ZIPs wait six hours for
 * their download (`services/accountArchive/archiveJobs.ts`). Without this they
 * were removed only when the next export started — a ZIP with every photo and
 * document of an account could sit in the work directory for months. Hourly, at
 * minute 17 (clear of the full-hour jobs), and once at start for files a restart
 * orphaned.
 */
import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { sweepExports } from "../services/accountArchive/archiveJobs";
import { sweepLifeBooks } from "../services/lifeBook/lifeBookJobs";
import { schedulerZone } from "../shared/time/schedulerZone";
import logger from "../utils/logger";

const CRON_EXPRESSION = "17 * * * *";

let task: ScheduledTask | null = null;

async function run(): Promise<void> {
  try {
    await sweepExports();
    // The life book's finished HTML files share the work directory and the six-hour wait.
    await sweepLifeBooks();
  } catch (error) {
    logger.warn({ operation: "account_archive_sweep_failed", error: String(error) });
  }
}

export function startAccountArchiveSweepScheduler(): void {
  if (task) return;
  task = cron.schedule(CRON_EXPRESSION, () => void run(), {
    timezone: schedulerZone("accountArchiveSweep"),
  });
  void run();
}

export function stopAccountArchiveSweepScheduler(): void {
  task?.stop();
  task = null;
}
