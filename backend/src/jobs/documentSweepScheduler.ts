/**
 * Document Sweep Scheduler (forgejo#116)
 *
 * Kept originals leave the disk in exactly one place: `sweepDocuments`. It
 * removes uploads that were never filed with an entry within a week, and the
 * bytes of every document whose row is gone — which is how a deleted flight,
 * stay, lodging, place, trip or account loses its files, whichever route
 * deleted it.
 *
 * Hourly rather than nightly because of that second job: a user who deletes a
 * bill expects it gone, and "within about two hours" (the hour of grace a young
 * file gets, plus the wait for the next run) is a promise that can be kept,
 * where "by tomorrow" is one nobody would guess.
 *
 * :25 past the hour stays clear of the top-of-hour status sweep. Both
 * containers run `TZ=UTC`, so the expression means what it says.
 */

import cron from "node-cron";

import { sweepDocuments } from "../services/documents/documentService";
import logger from "../utils/logger";

const CRON_EXPRESSION = "25 * * * *";

let schedulerTask: cron.ScheduledTask | null = null;

export async function runDocumentSweep(): Promise<void> {
  try {
    await sweepDocuments();
  } catch (error) {
    // A failed run is retried by the next one; it must not take the process down.
    logger.warn(
      {
        operation: "document_sweep_failed",
        message: error instanceof Error ? error.message : "unknown error",
      },
      "Document sweep failed; the next hourly run retries"
    );
  }
}

export function startDocumentSweepScheduler(): void {
  if (schedulerTask) return;
  schedulerTask = cron.schedule(CRON_EXPRESSION, () => {
    void runDocumentSweep();
  });
  logger.info(
    { operation: "document_sweep_scheduler_started", cron: CRON_EXPRESSION },
    "Document sweep scheduler started"
  );
}

export function stopDocumentSweepScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
