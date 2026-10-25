/**
 * Nightly trip inference from TravTrack (TravTrack plan L4): away-from-home
 * periods no trip holds become inbox questions.
 *
 * 04:25 UTC: after the 04:10 data-quality sweep, before the 04:40 Dawarich
 * country-day sweep (slot table in dataQualitySweepScheduler.ts).
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { runTravTrackTripSweep } from "../services/locationEvidence/trips/sweep";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "25 4 * * *";

let schedulerTask: ScheduledTask | null = null;

export async function runTravTrackTripJob(): Promise<void> {
  try {
    await runTravTrackTripSweep();
  } catch (error) {
    // Retried by the next night; nothing is asked meanwhile.
    logger.warn({ operation: "travtrack_trip_sweep_failed", error });
  }
}

export function startTravTrackTripScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runTravTrackTripJob();
    },
    { timezone: schedulerZone("travTrackTrips") }
  );
  logger.info({ operation: "travtrack_trip_scheduler_started", cron: CRON_EXPRESSION });
}

export function stopTravTrackTripScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
