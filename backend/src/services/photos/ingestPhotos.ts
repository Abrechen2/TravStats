import fsp from "fs/promises";
import path from "path";

import { isHeifMimetype, removeDisplayRendition, writeDisplayRendition } from "./displayRendition";
import { readPhotoExif, type PhotoExif } from "./photoExif";

/**
 * What every photo upload route does with the files multer has just stored,
 * before it writes a row: read the capture time and position, and give a
 * HEIC/HEIF original its JPEG display copy (forgejo#192).
 *
 * All or nothing, like the row transaction that follows: one HEIC that cannot
 * be decoded rejects the request with `PHOTO_UNREADABLE`, and the caller's
 * cleanup removes every original multer stored. Display copies written for
 * the files before it are removed here, because the caller does not know
 * they exist.
 */
export async function ingestUploadedPhotos(
  dir: string,
  files: readonly Express.Multer.File[]
): Promise<PhotoExif[]> {
  const written: string[] = [];
  const results: PhotoExif[] = [];
  try {
    // One after another: the converter runs one job at a time anyway, and a
    // queue of twenty full-size buffers would only raise the peak.
    for (const file of files) {
      const bytes = await fsp.readFile(path.join(dir, path.basename(file.filename)));
      if (isHeifMimetype(file.mimetype)) {
        await writeDisplayRendition(dir, file.filename, bytes);
        written.push(file.filename);
      }
      results.push(readPhotoExif(bytes));
    }
    return results;
  } catch (error) {
    for (const filename of written) removeDisplayRendition(dir, filename);
    throw error;
  }
}
