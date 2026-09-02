import logger from "../utils/logger";
import { runDataQualityChecks } from "./dataQuality";

/**
 * The seam between "something changed the account" and the data-quality inbox.
 *
 * The checks only ever WRITE flags — never a stat, an achievement or a passport
 * entry (see `routes/dataQualityFlags.ts` for that promise stated at the API).
 * That is what makes it safe to hang them off an import at all: the worst a run
 * can do is fail to ask a question.
 *
 * ## Why this swallows, when the house rule is that nothing swallows
 *
 * `~/.claude/rules/common/coding-style.md` says never silently swallow an
 * error, and everywhere else in this repo that is right. Here it is inverted on
 * purpose, and the inversion is the whole point of the file:
 *
 * > **An import must not fail, slow down, or return an error because a
 * > plausibility check threw.**
 *
 * The rows are already written and already usable when this runs. A check that
 * throws means one question went unasked — the nightly sweep
 * (`jobs/dataQualitySweepScheduler.ts`) asks it a few hours later. Propagating
 * it instead would turn a cosmetic failure into a failed import, which is the
 * one outcome the user cannot recover from by waiting.
 *
 * So it is swallowed, but not silent: every failure is logged at `warn` with
 * the trigger and the batch, which is the difference between swallowing and
 * hiding.
 *
 * ## Why it is not awaited
 *
 * `loadAccountSnapshot` reads the account's whole lodging, place, flight and
 * port-call set. Awaiting that inside a commit would add it to the import's
 * response time for no benefit the user can see in that same response — the
 * inbox is a separate panel. Callers therefore `void` this, and it is written
 * to never reject so that a `void` on it cannot take the process down: an
 * unhandled rejection on a detached promise crashes Node (the same reasoning
 * `routes/lodgingImport.ts` gives for its geocode backfill).
 */

/** Which seam kicked the run. Only used for the log line. */
export type DataQualityTrigger = "lodging_import" | "place_import";

export interface DataQualityTriggerContext {
  trigger: DataQualityTrigger;
  /** The import batch the rows arrived in, so a flag can be traced to its cause. */
  batchId: string;
}

/**
 * One run per account at a time, in this process.
 *
 * `runDataQualityChecks` reads the existing flags, decides, and then creates —
 * without a transaction. Two runs for the same account that overlap therefore
 * both see "no such flag" and both try to create it, and the unique index makes
 * the loser throw. Nothing is corrupted (that is what the index is for) but the
 * loser's whole run is abandoned mid-way, which is a worse outcome than making
 * it wait.
 *
 * It is a queue rather than a drop: a run that is skipped is a question about
 * rows that had not been written when the run in progress started, and skipping
 * it would silently push those to the nightly sweep. Chaining costs one extra
 * pass and keeps the promise this seam makes.
 *
 * Per process, not per instance. Two containers against one database can still
 * collide; the loser logs and the next trigger reconciles, which is the same
 * outcome as before this existed.
 */
const inFlight = new Map<string, Promise<void>>();

/**
 * Run every check for one account, detached.
 *
 * Resolves in every case — a rejection here would be a rejection of the import.
 */
export async function triggerDataQualityChecks(
  userId: string,
  context: DataQualityTriggerContext
): Promise<void> {
  const previous = inFlight.get(userId) ?? Promise.resolve();
  const next = previous.then(() => runOnce(userId, context));
  inFlight.set(userId, next);
  try {
    await next;
  } finally {
    // Only the last link clears the entry; an earlier one finishing must not
    // drop a successor that is still queued behind it.
    if (inFlight.get(userId) === next) inFlight.delete(userId);
  }
}

async function runOnce(userId: string, context: DataQualityTriggerContext): Promise<void> {
  try {
    const summary = await runDataQualityChecks(userId);
    logger.info(
      {
        operation: "data_quality_checks_after_import",
        userId,
        ...context,
        ...summary,
      },
      "Data-quality checks run after import"
    );
  } catch (error) {
    logger.warn(
      {
        operation: "data_quality_checks_after_import_failed",
        userId,
        ...context,
        message: error instanceof Error ? error.message : String(error),
      },
      "Data-quality checks failed after import — the import itself is unaffected"
    );
  }
}
