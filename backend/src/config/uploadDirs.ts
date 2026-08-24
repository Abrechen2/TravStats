/**
 * Every directory under `uploads/` — in ONE place, because the backup reads
 * this list.
 *
 * The file archive used to carry a hardcoded `['receipts', 'emails',
 * 'training']` under a comment that read "Add all upload directories". Three of
 * the six real directories were missing: `trip-photos`, `place-photos` and
 * `profile-pictures`. `TripPhoto` and `PlaceVisitPhoto` store only a
 * `filename`, so the database dump kept every photo ROW while the archive kept
 * none of the bytes — restore a backup and every image is a broken link,
 * silently, including Immich-imported originals.
 *
 * A new upload directory must be added here. `__tests__/uploadDirs.test.ts`
 * scans the source for `uploads/<name>` constants and fails when one is
 * missing, so the next directory cannot be forgotten the way these three were.
 */

import * as path from "path";

/** Absolute path to the uploads root. */
export const UPLOADS_ROOT = path.join(__dirname, "../../uploads");

/**
 * Directories the backup archives, in the order they are written.
 *
 * Everything under `uploads/` belongs here. There is deliberately no
 * "regenerable, skip it" category: the airline-logo disk cache lives outside
 * `uploads/`, and anything a user put there is theirs.
 */
export const BACKED_UP_UPLOAD_DIRS: readonly string[] = [
  "receipts",
  "emails",
  "training",
  "trip-photos",
  "place-photos",
  "profile-pictures",
] as const;
