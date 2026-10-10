/**
 * Document Sweep Scheduler (forgejo#116) — and the orphan sweep of every other
 * upload directory (forgejo#287)
 *
 * Kept originals leave the disk in exactly one place: `sweepDocuments`. It
 * removes uploads that were never filed with an entry within their TTL, and
 * moves the bytes of every document whose row is gone into the quarantine —
 * which is how a deleted flight, stay, lodging, place or trip loses its files,
 * whichever route deleted it.
 *
 * Hourly rather than nightly because of that second job: a user who deletes a
 * bill expects it gone, and "within about two hours" (the hour of grace a young
 * file gets, plus the wait for the next run) is a promise that can be kept,
 * where "by tomorrow" is one nobody would guess. Gone from the product and
 * from every later backup, that is: the quarantine is neither served nor
 * archived, and deletes for good after 30 days (`services/files/quarantine.ts`,
 * which says why an orphan is not deleted on the spot).
 *
 * The same run then sweeps every other upload directory with the same rule —
 * a file no row references, older than an hour, is quarantined
 * (`sweepOrphanUploads`). That is how a deleted trip, stay or place loses its
 * photos whichever route deleted it, and how a deleted account's file leaves
 * when the deletion step's own unlink failed. (A deleted account's files
 * otherwise go at once, through `services/files/accountFiles.ts`.)
 *
 * :25 past the hour stays clear of the top-of-hour status sweep. Both
 * containers run `TZ=UTC`, so the expression means what it says.
 */

import cron from "node-cron";
import type { ScheduledTask } from "node-cron";

import { sweepDocuments } from "../services/documents/documentService";
import { migrateLegacyReceipts, reconcileReceiptDocuments } from "../services/documents/receipts";
import { sweepOrphanUploads } from "../services/files/uploadSweep";
import logger from "../utils/logger";
import { schedulerZone } from "../shared/time/schedulerZone";

const CRON_EXPRESSION = "25 * * * *";

let schedulerTask: ScheduledTask | null = null;

export async function runDocumentSweep(): Promise<void> {
  try {
    // Order matters: a legacy receipt becomes a document, the document is filed
    // with the entry naming it, and only then does the sweep judge what is
    // still unfiled.
    await migrateLegacyReceipts();
    await reconcileReceiptDocuments();
    await sweepDocuments();
    // Documents were just swept, with their TTL; every other directory here.
    await sweepOrphanUploads({ except: ["documents"] });
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
  schedulerTask = cron.schedule(
    CRON_EXPRESSION,
    () => {
      void runDocumentSweep();
    },
    { timezone: schedulerZone("documentSweep") }
  );
  // Once at start as well, so receipts from before 2.7 move without waiting
  // for the first :25.
  void runDocumentSweep();
  logger.info(
    { operation: "document_sweep_scheduler_started", cron: CRON_EXPRESSION },
    "Document sweep scheduler started"
  );
}

export function stopDocumentSweepScheduler(): void {
  schedulerTask?.stop();
  schedulerTask = null;
}
