/**
 * TravTrack orphan-link sweep (TravTrack plan T2).
 *
 * A TravTrack point links to a flight or a trip without a foreign key, so
 * deleting a flight on any of its paths leaves the link behind. Harmless —
 * every read joins the entry it names — but it should not live forever: this
 * nightly job removes every link whose entry is gone. Points always stay.
 *
 * 03:55 UTC: after the 03:50 sync retention, before the 04:10 data-quality
 * sweep (slot table in dataQualitySweepScheduler.ts).
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { cleanupOrphanLinks } from "../services/travtrack/links";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "55 3 * * *";

let schedulerTask: ScheduledTask | null = null;

export async function runTravTrackOrphanLinkSweep(): Promise<void> {
  try {
    const removed = await cleanupOrphanLinks();
    logger.info({ operation: "travtrack_orphan_links_done", removed });
  } catch (error) {
    // Retried by the next run; until then a stale link is never read.
    logger.warn({ operation: "travtrack_orphan_links_failed", error });
  }
}

export function startTravTrackOrphanLinkScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runTravTrackOrphanLinkSweep();
    },
    { timezone: schedulerZone("travTrackOrphanLinks") }
  );
  logger.info({ operation: "travtrack_orphan_links_scheduler_started", cron: CRON_EXPRESSION });
}

export function stopTravTrackOrphanLinkScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
