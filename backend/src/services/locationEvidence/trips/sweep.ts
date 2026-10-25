/**
 * Trip inference for every TravTrack account (TravTrack plan L4), run nightly
 * by `jobs/travTrackTripScheduler.ts`. Every account whose location provider
 * is TravTrack is asked about the last 60 finished days (`suggestTrips`).
 * Nothing runs while the instance's TravTrack is off; Dawarich accounts are
 * never selected (open owner decision (c)). One account's failure is logged
 * and stops no other.
 */
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { TRAVTRACK_PROVIDER_WHERE } from "../../locationProvider/kinds";
import { travTrackInstanceOn } from "../../travtrack/availability";
import { suggestTrips } from "./suggest";

export async function runTravTrackTripSweep(nowMs?: number): Promise<void> {
  if (!(await travTrackInstanceOn())) return;
  const accounts = await prisma.userSettings.findMany({
    where: TRAVTRACK_PROVIDER_WHERE,
    select: { userId: true },
  });
  for (const { userId } of accounts) {
    try {
      const result = await suggestTrips(userId, { nowMs });
      if (result.status !== "done") {
        logger.info({ operation: "travtrack_trips_not_run", userId, ...result });
      }
    } catch (error) {
      logger.error({ operation: "travtrack_trips_failed", userId, error }, "Trip scan failed");
    }
  }
}
