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

import { prisma } from "../db";
import { scanPhotoJourneys } from "../services/photoJourneys/scan";
import logger from "../utils/logger";

const CRON_EXPRESSION = "55 4 * * *";
export const NIGHTLY_WINDOW_DAYS = 400;

let schedulerTask: cron.ScheduledTask | null = null;

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
        continue;
      }
      result.scanned += 1;
      result.created += outcome.created;
    } catch (error) {
      result.failed += 1;
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
  schedulerTask = cron.schedule(CRON_EXPRESSION, () => {
    void runPhotoJourneyNightlyScan();
  });
}

export function stopPhotoJourneyScanScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
