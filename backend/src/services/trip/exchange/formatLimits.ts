/** Hard limits on what a reader unpacks — a few KB of ZIP must not become gigabytes. */
export const TRIP_FILE_LIMITS = {
  /** The upload itself. */
  maxUploadBytes: 100 * 1024 * 1024,
  /** Everything unpacked together, as actually inflated (not as declared). */
  maxTotalBytes: 300 * 1024 * 1024,
  maxEntries: 2000,
  maxManifestBytes: 64 * 1024,
  maxTripJsonBytes: 10 * 1024 * 1024,
  maxDocumentBytes: 25 * 1024 * 1024,
  maxPhotoBytes: 15 * 1024 * 1024,
} as const;

/** The only names a file entry may carry inside `documents/` and `photos/`. */
export const ENTRY_FILE_NAME = /^[A-Za-z0-9_-]{1,64}\.[a-z0-9]{1,8}$/;
