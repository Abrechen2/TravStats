/**
 * Why an account archive (forgejo#433) could not be written or read. Part of
 * `ApiErrorCode` (`apiErrorCode.ts`); the settings page maps each to DE/EN copy.
 */
export type AccountArchiveApiErrorCode =
  /** The account's files and rows exceed `ACCOUNT_ARCHIVE_MAX_BYTES` (413). */
  | "ACCOUNT_ARCHIVE_TOO_LARGE"
  /** An export or import of this account is already running (409). */
  | "ACCOUNT_ARCHIVE_BUSY"
  /** The export is unknown, expired or someone else's (404). */
  | "ACCOUNT_ARCHIVE_NOT_FOUND"
  /** Not a TravStats account archive, or its manifest does not describe its entries (422). */
  | "ACCOUNT_ARCHIVE_INVALID"
  /** An entry's bytes do not match the sha256 its manifest records (422). */
  | "ACCOUNT_ARCHIVE_CHECKSUM"
  /** Written by a newer TravStats in a format this server cannot read yet (422). */
  | "ACCOUNT_ARCHIVE_FORMAT_TOO_NEW"
  /** It names tables or columns this server's database does not have: update first (422). */
  | "ACCOUNT_ARCHIVE_SCHEMA_TOO_NEW"
  /** The target account already holds data; a merge is not supported (409). */
  | "ACCOUNT_ARCHIVE_TARGET_NOT_EMPTY"
  /** This archive was already imported into another account on this server (409). */
  | "ACCOUNT_ARCHIVE_ALREADY_IMPORTED";
