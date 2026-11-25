import { apiErrorMachineCode } from "../../lib/apiError";
import { JobLostError, jobErrorCode } from "../../lib/api/jobs";

/** Why a restore did not happen, as the one thing the page tells the admin. */
export type RestoreOutcome =
  | "keyMismatch"
  | "recoveryKeyInvalid"
  | "recoveryKeyWrong"
  | "recoveryKeyEnvPinned"
  | "recoveryKeyWriteFailed"
  | "recoveryKeyReauth"
  | "recoveryKeySecondFactor"
  | "recoveryKeyPasskey"
  | "recoveryKeyPasskeyTooNew"
  | "keySwapUnresolved"
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
  RESTORE_RECOVERY_KEY_INVALID: "recoveryKeyInvalid",
  RESTORE_RECOVERY_KEY_WRONG: "recoveryKeyWrong",
  RESTORE_RECOVERY_KEY_ENV_PINNED: "recoveryKeyEnvPinned",
  RESTORE_RECOVERY_KEY_WRITE_FAILED: "recoveryKeyWriteFailed",
  RESTORE_RECOVERY_KEY_REVERT_FAILED: "failed",
  RESTORE_KEY_SWAP_UNRESOLVED: "keySwapUnresolved",
  RECOVERY_KEY_REAUTH_REQUIRED: "recoveryKeyReauth",
  REAUTH_PASSWORD_INCORRECT: "recoveryKeyReauth",
  REAUTH_SECOND_FACTOR_REQUIRED: "recoveryKeySecondFactor",
  REAUTH_SECOND_FACTOR_INVALID: "recoveryKeySecondFactor",
  DELETE_PASSKEY_INVALID: "recoveryKeyPasskey",
  PASSKEY_UNAVAILABLE: "recoveryKeyPasskey",
  REAUTH_PASSKEY_TOO_NEW: "recoveryKeyPasskeyTooNew",
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

/** Outcomes of a pasted recovery key that keep the key dialog open: nothing was
 *  restored, and the admin can correct the key and try again. */
export const RECOVERY_KEY_OUTCOMES: ReadonlySet<RestoreOutcome> = new Set([
  "recoveryKeyInvalid",
  "recoveryKeyWrong",
  "recoveryKeyEnvPinned",
  "recoveryKeyWriteFailed",
  "recoveryKeyReauth",
  "recoveryKeySecondFactor",
  "recoveryKeyPasskey",
  "recoveryKeyPasskeyTooNew",
  "keySwapUnresolved",
]);
