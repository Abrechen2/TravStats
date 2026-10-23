/**
 * Why an uploaded server connection file (Admin → Server-Verbindungen) was
 * refused — one code per reason so the admin reads which, raised through
 * `comparisonError()` in `routes/admin/federation.ts`. Part of `ApiErrorCode`
 * (`errorHandler.ts`), kept here because that file sits at its size limit; the
 * frontend maps each to DE/EN copy (`federation.error.*` in `admin.json`).
 */
export type ConnectionFileApiErrorCode =
  /** Neither a ZIP nor JSON, a damaged ZIP, one without the entry, or the entry twice. */
  | "COMPARISON_CONNECTION_FILE_UNREADABLE"
  /** The upload, or the entry as actually inflated, is past its byte cap (413). */
  | "COMPARISON_CONNECTION_FILE_TOO_LARGE"
  /** JSON that is not a connection file of a known format and version. */
  | "COMPARISON_CONNECTION_FILE_FORMAT"
  /** The address is not an https origin without port, path or credentials. */
  | "COMPARISON_CONNECTION_FILE_ORIGIN"
  /** Not an Ed25519 public key — including a private key, which is refused outright. */
  | "COMPARISON_CONNECTION_FILE_KEY"
  /** The fingerprint the file states is not the one its key hashes to. */
  | "COMPARISON_CONNECTION_FILE_FINGERPRINT"
  /** The file describes this server itself. */
  | "COMPARISON_CONNECTION_FILE_SELF";
