/**
 * Missing journeys for every TravTrack account (TravTrack plan E7), run by the
 * stay sweep right after its TravTrack stay scans (`jobs/dawarichStayScheduler.ts`)
 * — the plan's "after the TravTrack stay scan, same window". There is no slot
 * of its own.
 *
 * Every account whose location provider is TravTrack is asked about the last
 * seven finished days (`suggestJourneys`), whether or not it consented to stay
 * suggestions: a journey question is its own question. Nothing runs while the
 * instance's TravTrack is off; Dawarich accounts are never selected (open
 * owner decision (c)). One account's failure is logged and stops no other.
 */
import { prisma } from "../../../db";
import { TRAVTRACK_PROVIDER_WHERE } from "../../locationProvider/kinds";
import { travTrackInstanceOn } from "../../travtrack/availability";
import logger from "../../../utils/logger";
import { suggestJourneys } from "./suggest";

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
