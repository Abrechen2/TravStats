import { jobErrorCode } from "./api/jobs";

/**
 * The cause codes a backup or restore job ends with (backend
 * `services/backup/backupFailure.ts`). Each one needs a different action from
 * the admin, so each gets its own sentence under `admin:backup.failure.*`
 * (acceptance 2026-09-26: the page said only "Fehler beim Erstellen des
 * Backups" while the server log knew "spawn pg_dump ENOENT").
 */
const BACKUP_FAILURE_CODES: ReadonlySet<string> = new Set([
  "BACKUP_TOOL_MISSING",
  "BACKUP_DISK_FULL",
  "BACKUP_PERMISSION_DENIED",
  "BACKUP_DB_UNREACHABLE",
  "BACKUP_TOOL_VERSION_MISMATCH",
  "BACKUP_FAILED",
  "RESTORE_FAILED",
]);

/** The translation key for a failed backup/restore job, else `fallbackKey`. */
export function backupFailureKey(err: unknown, fallbackKey: string): string {
  const code = jobErrorCode(err);
  return code && BACKUP_FAILURE_CODES.has(code) ? `admin:backup.failure.${code}` : fallbackKey;
}
