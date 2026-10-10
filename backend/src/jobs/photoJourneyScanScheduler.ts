/**
 * Photo-Journey Scan Scheduler (forgejo#94, point 5)
 *
 * The Foto-Spürhund used to run only when somebody sent `POST /photo-journeys/scan`
 * by hand, so the suggestions it exists to make never arrived on their own.
 * This runs it every night for the accounts that asked for it.
 *
 * ## Opt-in, per account
 *
 * `UserSettings.photoJourneyNightlyScan`, off by default — the same stance as
 * flight auto-updates. A scan reads the user's whole Immich library in the
 * window and sends the positions of what it finds to a third-party geocoder
 * (Nominatim, at most 40 lookups, throttled to 1 req/s). That is not something
 * to start doing to an account nobody asked about.
 *
 * ## The window
 *
 * The last 400 days: this year's photos plus the tail of last year, so a trip
 * that ended in January is still caught. A nightly run over ten years would
 * repeat the same answer every night at the cost of the whole library; the
 * full-history scan stays the manual `POST /photo-journeys/scan`, and a
 * journey found by either is one row (the fingerprint is the same).
 *
 * ## The slot
 *
 * 04:55 UTC — after the data-quality sweep (04:10) and the Dawarich
 * country-day sweep (04:40), and clear of the outbound-heavy 03:00/03:20
 * jobs, because this one is outbound-heavy too.
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { prisma } from "../db";
import { scanPhotoJourneys } from "../services/photoJourneys/scan";
import { ImmichError } from "../services/immich/types";
import {
  NIGHTLY_CRON_EXPRESSION,
  NIGHTLY_WINDOW_DAYS,
} from "../services/photoJourneys/nightlySchedule";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = NIGHTLY_CRON_EXPRESSION;
export { NIGHTLY_WINDOW_DAYS };

/** What one account's nightly run ended in — stored for its settings card. */
type LastRun =
  | { result: "scanned"; created: number }
  | { result: "noImmich" }
  | { result: "failed"; failure: string };

/**
 * Written per account after its run, so the opt-in is not a switch that may be
 * failing every night without anyone seeing it. A failed write is logged and
 * never ends the night: the scan itself already happened.
 */
async function recordLastRun(userId: string, at: Date, run: LastRun): Promise<void> {
  try {
    await prisma.userSettings.update({
      where: { userId },
      data: {
        photoJourneyLastScanAt: at,
        photoJourneyLastScanResult: run.result,
        photoJourneyLastScanFailure: run.result === "failed" ? run.failure : null,
        photoJourneyLastScanCreated: run.result === "scanned" ? run.created : null,
      },
    });
  } catch (error) {
    logger.warn(
      {
        operation: "photo_journey_nightly_record_failed",
        userId,
        message: error instanceof Error ? error.message : String(error),
      },
      "Could not record the nightly photo-journey result for one account"
    );
  }
}

let schedulerTask: ScheduledTask | null = null;

export interface PhotoJourneyNightlyResult {
  users: number;
  scanned: number;
  skippedNoImmich: number;
  failed: number;
  created: number;
}

/**
 * One pass over every account that opted in, one after another: each scan is
 * throttled by the geocoder anyway, and running two at once would only share
 * the same one-request-per-second between them. One account's failure (an
 * unreachable Immich) does not end the night for the others.
 */
export async function runPhotoJourneyNightlyScan(
  now = new Date()
): Promise<PhotoJourneyNightlyResult> {
  const optedIn = await prisma.userSettings.findMany({
    where: { photoJourneyNightlyScan: true },
    select: { userId: true },
    orderBy: { userId: "asc" },
  });
  const since = new Date(now.getTime() - NIGHTLY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const result: PhotoJourneyNightlyResult = {
    users: optedIn.length,
    scanned: 0,
    skippedNoImmich: 0,
    failed: 0,
    created: 0,
  };

  for (const { userId } of optedIn) {
    try {
      const outcome = await scanPhotoJourneys(userId, { since, until: now });
      if (outcome.kind === "no-immich") {
        result.skippedNoImmich += 1;
        await recordLastRun(userId, now, { result: "noImmich" });
        continue;
      }
      result.scanned += 1;
      result.created += outcome.created;
      await recordLastRun(userId, now, { result: "scanned", created: outcome.created });
    } catch (error) {
      result.failed += 1;
      // The Immich vocabulary the web already speaks; anything else is ours.
      const failure = error instanceof ImmichError ? error.kind : "internal";
      await recordLastRun(userId, now, { result: "failed", failure });
      logger.warn(
        {
          operation: "photo_journey_nightly_user_failed",
          userId,
          message: error instanceof Error ? error.message : String(error),
        },
        "Nightly photo-journey scan failed for one account — the run continues"
      );
    }
  }

  logger.info(
    { operation: "photo_journey_nightly_done", ...result },
    "Nightly photo-journey scan complete"
  );
  return result;
}

export function startPhotoJourneyScanScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runPhotoJourneyNightlyScan();
    },
    { timezone: schedulerZone("photoJourneyScan") }
  );
}

export function stopPhotoJourneyScanScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
