/**
 * Missing journeys, nightly (TravTrack plan E7).
 *
 * Every account whose location provider is TravTrack is asked once a night
 * about the last seven finished days (`suggestJourneys`). Nothing runs while
 * the instance's TravTrack is off; Dawarich accounts are never selected (open
 * owner decision (c)). One account's failure is logged and stops no other.
 *
 * Merge note: the plan runs this "after the TravTrack stay scan" (E3, another
 * branch). Until that scan exists here it has its own slot; once both are in,
 * the stay scan's TravTrack branch can call `suggestJourneys` itself and this
 * schedule goes.
 *
 * 05:05 UTC: after the 04:55 photo-journey scan (slot table in
 * dataQualitySweepScheduler.ts).
 */
import cron, { type ScheduledTask } from "node-cron";

import { prisma } from "../db";
import { suggestJourneys } from "../services/locationEvidence/journeys/suggest";
import { TRAVTRACK_PROVIDER_WHERE } from "../services/locationProvider/kinds";
import { travTrackInstanceOn } from "../services/travtrack/availability";
import { schedulerZone } from "../shared/time/schedulerZone";
import logger from "../utils/logger";

const CRON_EXPRESSION = "5 5 * * *";

let task: ScheduledTask | null = null;

export async function runTravTrackJourneySweep(nowMs?: number): Promise<void> {
  if (!(await travTrackInstanceOn())) return;
  const accounts = await prisma.userSettings.findMany({
    where: TRAVTRACK_PROVIDER_WHERE,
    select: { userId: true },
  });
  for (const { userId } of accounts) {
    try {
      const result = await suggestJourneys(userId, { nowMs });
      if (result.status !== "done") {
        logger.info({ operation: "travtrack_journeys_not_run", userId, ...result });
      }
    } catch (error) {
      logger.error(
        { operation: "travtrack_journeys_failed", userId, error },
        "Journey scan failed"
      );
    }
  }
}

export function startTravTrackJourneyScheduler(): void {
  if (task) return;
  task = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runTravTrackJourneySweep().catch((error: unknown) =>
        logger.error({ operation: "travtrack_journey_sweep_failed", error }, "Journey sweep failed")
      );
    },
    { timezone: schedulerZone("travTrackJourneys") }
  );
  logger.info({ operation: "travtrack_journeys_scheduler_started", cron: CRON_EXPRESSION });
}

export function stopTravTrackJourneyScheduler(): void {
  task?.stop();
  task = null;
}
