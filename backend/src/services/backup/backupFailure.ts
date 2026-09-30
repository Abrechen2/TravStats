import { AppError, type ApiErrorCode } from "../../middleware/errorHandler";

/**
 * Why a backup or a restore failed, as a stable code the admin page turns
 * into a sentence (acceptance 2026-09-26). The job used to end in JOB_FAILED
 * and the page said "Fehler beim Erstellen des Backups" while the server log
 * knew exactly what was wrong — "spawn pg_dump ENOENT", a tool that is not
 * installed. The failures below each need a different action from the admin.
 *
 * Read from the message because the backup services wrap every cause in a new
 * `Error` whose text carries the original (`Failed to start pg_dump: spawn
 * pg_dump ENOENT`, `pg_dump exited with code 1: … Connection refused`); the
 * original `code` property does not survive the wrap, its words do.
 */
const RULES: ReadonlyArray<readonly [RegExp, ApiErrorCode]> = [
  [
    /spawn \S*(pg_dump|pg_restore|psql|tar|docker)\S* ENOENT|command not found/i,
    "BACKUP_TOOL_MISSING",
  ],
  [/ENOSPC|no space left on device|disk (is )?full/i, "BACKUP_DISK_FULL"],
  [/EACCES|EPERM|permission denied/i, "BACKUP_PERMISSION_DENIED"],
  [/server version mismatch|aborting because of server version/i, "BACKUP_TOOL_VERSION_MISMATCH"],
  [
    /ECONNREFUSED|connection refused|could not connect|could not translate host name|password authentication failed|the database system is (starting up|shutting down)|Docker container not found/i,
    "BACKUP_DB_UNREACHABLE",
  ],
];

/** The specific cause in a failure, or null when none is recognised. */
export function backupFailureCode(err: unknown): ApiErrorCode | null {
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  for (const [pattern, code] of RULES) if (pattern.test(text)) return code;
  return null;
}

/**
 * The error a backup or restore job ends with. A failure that already names
 * its code (the restore preflight's RESTORE_ARCHIVE_*, a 4xx precondition)
 * passes through untouched; anything else gets the recognised cause, else the
 * operation's generic code — never the bare JOB_FAILED.
 */
/** A backup the server was stopped or restored in the middle of (`reconcileBackups.ts`). */
const INTERRUPTED_PREFIX = "Interrupted:";

/**
 * The reason code a failed backup ROW carries (acceptance D12, 2026-09-26: a
 * failed row in the history showed no reason once the toast was gone). The
 * stored code where the row has one; for a row written before the column,
 * the code its English message still yields — the same rules as the job's.
 * Null for a row that did not fail.
 */
export function backupRowFailureCode(row: {
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
}): string | null {
  if (row.status !== "failed") return null;
  if (row.errorCode) return row.errorCode;
  if (row.errorMessage?.startsWith(INTERRUPTED_PREFIX)) return "BACKUP_INTERRUPTED";
  return backupFailureCode(row.errorMessage ?? "") ?? "BACKUP_FAILED";
}

export function asBackupJobError(
  err: unknown,
  fallback: "BACKUP_FAILED" | "RESTORE_FAILED"
): AppError {
  if (err instanceof AppError && err.code) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new AppError(message, 500, backupFailureCode(err) ?? fallback);
}
