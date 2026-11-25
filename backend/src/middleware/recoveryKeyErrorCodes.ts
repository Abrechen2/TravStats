/**
 * Why a recovery-key call (backup settings, restore) was refused. Part of
 * `ApiErrorCode` (`apiErrorCode.ts`). See `services/backup/recoveryKey.ts`.
 */
export type RecoveryKeyApiErrorCode =
  /** A confirm without a reveal by the same admin in the last half hour. */
  | "RECOVERY_KEY_NOT_REVEALED"
  /** The confirm body was not exactly four characters. */
  | "RECOVERY_KEY_CONFIRM_FORMAT"
  /** The four characters are not the end of the key. */
  | "RECOVERY_KEY_CONFIRM_MISMATCH"
  /** A reveal body carried neither a password nor a passkey assertion. */
  | "RECOVERY_KEY_REAUTH_REQUIRED"
  /** The pasted restore key is not 64 hexadecimal characters. */
  | "RESTORE_RECOVERY_KEY_INVALID"
  /** The pasted restore key is well-formed but is not the key that wrote the archive. */
  | "RESTORE_RECOVERY_KEY_WRONG"
  /** The key is set by the ENCRYPTION_KEY environment variable; a file write would not survive a restart. */
  | "RESTORE_RECOVERY_KEY_ENV_PINNED"
  /** The pasted key could not be written to the secrets directory. */
  | "RESTORE_RECOVERY_KEY_WRITE_FAILED"
  /** The replay failed and the previous key could not be written back; the message names the copy. */
  | "RESTORE_RECOVERY_KEY_REVERT_FAILED";
