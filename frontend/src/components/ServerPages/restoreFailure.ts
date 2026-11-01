import { apiErrorMachineCode } from "../../lib/apiError";
import { JobLostError, jobErrorCode } from "../../lib/api/jobs";

/** Why a restore did not happen, as the one thing the page tells the admin. */
export type RestoreOutcome =
  | "keyMismatch"
  | "unknown"
  | "incomplete"
  | "unreadable"
  | "migrationFailed"
  | "schemaIncomplete"
  | "newer"
  | "unversioned"
  | "busy"
  | "rateLimited"
  | "failed";

const BY_CODE: Record<string, RestoreOutcome> = {
  RESTORE_ENCRYPTION_KEY_MISMATCH: "keyMismatch",
  RESTORE_ARCHIVE_INCOMPLETE: "incomplete",
  RESTORE_ARCHIVE_UNREADABLE: "unreadable",
  RESTORE_MIGRATION_FAILED: "migrationFailed",
  RESTORE_SCHEMA_INCOMPLETE: "schemaIncomplete",
  RESTORE_ARCHIVE_NEWER: "newer",
  RESTORE_ARCHIVE_UNVERSIONED: "unversioned",
  RESTORE_ARCHIVE_FAILED_MIGRATION: "unversioned",
};

/**
 * Maps a refused or failed restore to its outcome. A job the server forgot is
 * its own outcome ("I don't know whether it finished"), a 409 means another
 * restore or backup is running, a 429 that the hourly limit is reached; every
 * code without a sentence of its own reads as "failed" — never as the server's
 * English text.
 */
export function restoreOutcome(error: unknown): RestoreOutcome {
  if (error instanceof JobLostError) return "unknown";
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  const code = jobErrorCode(error) ?? apiErrorMachineCode(error);
  if (code && BY_CODE[code]) return BY_CODE[code];
  if (status === 429) return "rateLimited";
  if (status === 409) return "busy";
  return "failed";
}
