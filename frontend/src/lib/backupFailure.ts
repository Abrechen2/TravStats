import { apiErrorMachineCode } from "./apiError";
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
  "BACKUP_INTERRUPTED",
  "RESTORE_FAILED",
]);

/**
 * The sentence for a failed backup ROW in the history, from the code the row
 * stores (D12: the row said "Fehlgeschlagen" and nothing else once the toast
 * was gone). An unknown or missing code reads as the generic failure.
 */
export function backupRowFailureKey(code: string | null | undefined): string {
  return `admin:backup.failure.${code && BACKUP_FAILURE_CODES.has(code) ? code : "BACKUP_FAILED"}`;
}

/** The translation key for a failed backup/restore job, else `fallbackKey`. */
export function backupFailureKey(err: unknown, fallbackKey: string): string {
  const code = jobErrorCode(err);
  return code && BACKUP_FAILURE_CODES.has(code) ? `admin:backup.failure.${code}` : fallbackKey;
}

/** The causes a WebDAV backup upload or download job ends with, each with its own sentence. */
const CLOUD_FAILURE_CODES: ReadonlySet<string> = new Set([
  "WEBDAV_BACKUP_AUTH",
  "WEBDAV_BACKUP_QUOTA",
  "WEBDAV_BACKUP_TIMEOUT",
  "WEBDAV_BACKUP_UNREACHABLE",
  "WEBDAV_BACKUP_SHARE_ERROR",
  "WEBDAV_BACKUP_NOT_ON_SHARE",
  "WEBDAV_BACKUP_FILE_MISSING",
  "WEBDAV_NOT_ENABLED",
  "WEBDAV_NOT_CONFIGURED",
  "WEBDAV_BACKUP_BUSY",
  "WEBDAV_BACKUP_EXISTS",
  "WEBDAV_DOWNLOAD_CHECKSUM_MISMATCH",
]);

/**
 * The key for a failed WebDAV backup upload or download — from a job's error
 * code or a synchronous refusal alike. A body cut short is its own sentence
 * (`WEBDAV_DOWNLOAD_TRUNCATED`): the archive would have been unusable, and the
 * retry is the only remedy. An unknown code reads as `fallbackKey`.
 */
export function cloudBackupFailureKey(err: unknown, fallbackKey: string): string {
  const code = jobErrorCode(err) ?? apiErrorMachineCode(err);
  if (code === "WEBDAV_DOWNLOAD_TRUNCATED") return "admin:backup.toasts.downloadTruncated";
  return code && CLOUD_FAILURE_CODES.has(code) ? `admin:backup.cloudFailure.${code}` : fallbackKey;
}
