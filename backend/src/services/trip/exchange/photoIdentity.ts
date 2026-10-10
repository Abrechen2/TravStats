/**
 * Is a photo of a `.travstats` file already on the trip? Its BYTES decide —
 * the SHA-256 of the archive entry against the SHA-256 of each stored photo
 * file. Nothing the file merely states counts as identity: not the entry's
 * name, not a capture time, not a size, and not a hash it might carry.
 *
 * Size and capture time used to be the key, and two different photos of the
 * same byte count without a capture time were "the same photo" — the second
 * was skipped in the preview and silently not written by the commit
 * (forgejo#276). Size survives only as a pre-filter: equal bytes imply an equal
 * size, so a stored photo of another size is never read from disk.
 *
 * The proposal and the commit both ask `knownPhotoHashes`, so the two cannot
 * decide differently. A stored row whose file is gone proves nothing and
 * matches nothing — importing then restores the photo instead of claiming it
 * is there.
 */
import fs from "fs";
import path from "path";
import { prisma } from "../../../db";
import { getTripPhotoDir } from "../../../middleware/upload";
import logger from "../../../utils/logger";
import { sha256Hex } from "../../documents/documentStore";

export interface StoredPhoto {
  filename: string;
  sizeBytes: number;
}

/** The content hashes of the stored photos whose size an incoming photo shares. */
export function hashesOfStoredPhotos(
  stored: StoredPhoto[],
  incomingSizes: ReadonlySet<number>,
  dir: string = getTripPhotoDir()
): Set<string> {
  const hashes = new Set<string>();
  for (const p of stored) {
    if (!incomingSizes.has(p.sizeBytes)) continue;
    try {
      hashes.add(sha256Hex(fs.readFileSync(path.join(dir, path.basename(p.filename)))));
    } catch (error) {
      logger.warn({ operation: "trip_import_photo_unreadable", filename: p.filename, error });
    }
  }
  return hashes;
}

/** The hashes of the photos already on `tripId` that an incoming photo could equal. */
export async function knownPhotoHashes(
  tripId: string | null,
  incoming: Buffer[]
): Promise<Set<string>> {
  if (!tripId || incoming.length === 0) return new Set();
  const stored = await prisma.tripPhoto.findMany({
    where: { tripId },
    select: { filename: true, sizeBytes: true },
  });
  return hashesOfStoredPhotos(stored, new Set(incoming.map((b) => b.length)));
}

export const photoHash = (bytes: Buffer): string => sha256Hex(bytes);
