import { prisma } from "../../db";
import logger from "../../utils/logger";

/**
 * Clear backup rows that claim to be in flight while nothing is running.
 *
 * `running` is a transient, process-local state: `createBackup` writes the row
 * first and flips it to `completed` after the dump. Nothing outside the running
 * process can own that state, so any `running` or `pending` row surviving into
 * a moment where this process holds no backup is a leftover — and a costly one,
 * because it is also the lock. `POST /backup` and `POST /backup/:id/restore`
 * both refuse with 409 while one exists, and `backupScheduler` skips its run on
 * the same query. One stale row therefore stops every future backup silently.
 *
 * Two ways in, both reported:
 *
 *  - **A successful restore (AUD-069).** A backup dumps the database while its
 *    own row still says `running`, so the archive carries that row. Restoring
 *    it puts `running` back — the very backup that produced the archive,
 *    resurrected as active. The restore route checks for a running operation
 *    *before* it starts and never creates such a row itself, so after the dump
 *    is loaded every `running` row provably came out of the snapshot.
 *  - **A crash or a kill mid-backup.** The row is written before the work and
 *    never updated again. Codex read the startup and scheduler paths looking
 *    for a cleanup and found none; this is it.
 *
 * Call this ONLY where the process is known to hold no backup of its own —
 * at startup, and after a restore has replaced the database. Calling it beside
 * a live backup would mark that backup failed while it is still writing.
 */
export async function reconcileInterruptedBackups(reason: string): Promise<number> {
  const { count } = await prisma.backup.updateMany({
    where: { status: { in: ["running", "pending"] } },
    data: {
      status: "failed",
      errorMessage: `Interrupted: ${reason}`,
      completedAt: new Date(),
    },
  });

  if (count > 0) {
    logger.warn({
      operation: "backup_interrupted_reconciled",
      message: "Cleared backup rows left in an in-flight state",
      context: { count, reason },
    });
  }

  return count;
}
