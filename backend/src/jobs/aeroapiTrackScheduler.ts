/**
 * AeroAPI track sweep (forgejo#409): hourly, a no-op until the admin switches
 * `aeroapiTracksEnabled` on. See services/aeroapiTrack.ts.
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import logger from "../utils/logger";
import { sweepAeroapiTracks } from "../services/aeroapiTrack";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "17 * * * *";

let schedulerTask: ScheduledTask | null = null;

export function startAeroapiTrackScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    async () => {
      try {
        const summary = await sweepAeroapiTracks();
        if (summary.status !== "disabled" && summary.status !== "nothing_to_do") {
          logger.info({ operation: "aeroapi_track_sweep", ...summary }, "AeroAPI track sweep done");
        }
      } catch (error) {
        logger.warn(
          {
            operation: "aeroapi_track_sweep_error",
            error: error instanceof Error ? error.message : "unknown",
          },
          "AeroAPI track sweep failed"
        );
      }
    },
    { timezone: schedulerZone("aeroapiTracks") }
  );
  logger.info(
    { operation: "aeroapi_track_scheduler_started", cron: CRON_EXPRESSION },
    "AeroAPI track scheduler started"
  );
}

export function stopAeroapiTrackScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
