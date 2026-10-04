import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";

import { AppError } from "../../middleware/errorHandler";
import { photoVariantSchema, type PhotoVariant } from "../../schemas/photoVariant";
import logger from "../../utils/logger";
import { convertHeicToJpeg, HeicDecodeError } from "./heicConverter";

/**
 * HEIC/HEIF photos: the original is kept, the browser gets a JPEG
 * (forgejo#192).
 *
 * ## Convert on ingest, not on read
 *
 * A gallery fetches every photo it shows through `/file`; decoding a 12-MP
 * HEIC costs a second or more of CPU and a few hundred MB, so rendering on
 * read would pay that on every page view by every client, or need a cache —
 * which is a rendition on disk with a worse failure mode. Converting once on
 * upload pays it once, and it is the only point where a file that cannot be
 * decoded can still be REFUSED: an undisplayable photo stored silently is a
 * broken tile the user only meets later, with nothing left to do about it.
 *
 * ## On disk
 *
 * The original stays exactly as uploaded under its row's `filename` — the
 * Companion sends originals so a later Immich link can match the bytes by
 * checksum. The JPEG sits beside it as `<filename>.display.jpg`, a name
 * derived from the row's, so no column is needed and every directory-level
 * operation (backup, restore) carries it along. The delete helpers in
 * `middleware/upload.ts` remove it with the original.
 *
 * A rendition that is missing anyway (a restore from before it existed, a
 * hand-copied directory) is rebuilt on first read rather than answered 404.
 */

export const HEIF_MIME_TYPES: readonly string[] = ["image/heic", "image/heif"];

export function isHeifMimetype(mimetype: string): boolean {
  return HEIF_MIME_TYPES.includes(mimetype.toLowerCase());
}

/** The display copy's file name for a stored original. */
export function displayRenditionName(filename: string): string {
  return `${path.basename(filename)}.display.jpg`;
}

/** A HEIC/HEIF upload that could not be decoded — the file's fault (422). */
export class PhotoUnreadableError extends AppError {
  constructor(filename: string) {
    super(
      `The photo "${filename}" could not be read as a HEIC/HEIF image`,
      422,
      "PHOTO_UNREADABLE"
    );
    this.name = "PhotoUnreadableError";
  }
}

/** The converter failed for a reason that is not the file's (503). */
export class PhotoConversionUnavailableError extends AppError {
  constructor() {
    super(
      "The photo could not be converted right now; try again later",
      503,
      "PHOTO_CONVERSION_UNAVAILABLE"
    );
    this.name = "PhotoConversionUnavailableError";
  }
}

/**
 * Writes the JPEG display copy of a stored HEIC/HEIF original and returns its
 * path. Throws `PhotoUnreadableError` / `PhotoConversionUnavailableError`.
 *
 * Written to a temporary name and renamed, so a reader never sees half a JPEG
 * and two concurrent first reads cannot interleave their bytes.
 */
export async function writeDisplayRendition(
  dir: string,
  filename: string,
  originalBytes?: Uint8Array
): Promise<string> {
  const original = path.join(dir, path.basename(filename));
  const target = path.join(dir, displayRenditionName(filename));
  const bytes = originalBytes ?? (await fsp.readFile(original));
  let jpeg: Buffer;
  try {
    jpeg = await convertHeicToJpeg(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({
      operation: "photo_heic_conversion_failed",
      message: "A HEIC/HEIF photo could not be converted to JPEG",
      context: { filename: path.basename(filename), bytes: bytes.byteLength },
      error: { message },
    });
    if (error instanceof HeicDecodeError) throw new PhotoUnreadableError(path.basename(filename));
    throw new PhotoConversionUnavailableError();
  }
  const temp = `${target}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fsp.writeFile(temp, jpeg);
  await fsp.rename(temp, target);
  return target;
}

/** Removes a display copy if there is one; never throws (a leftover byte beats a failed delete). */
export function removeDisplayRendition(dir: string, filename: string): void {
  const target = path.join(dir, displayRenditionName(filename));
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch (error) {
    logger.warn({
      operation: "photo_rendition_delete_error",
      message: "Failed to delete a photo's display copy",
      context: { filename: path.basename(filename) },
      error: { message: error instanceof Error ? error.message : "Unknown error" },
    });
  }
}

/** Reads `?variant=` off a query; an unknown value is a 400 through the ZodError path. */
export function parsePhotoVariant(query: Record<string, unknown>): PhotoVariant {
  return photoVariantSchema.parse(query.variant);
}

/**
 * Which file a `/file` request is answered with, and as what type. Null when
 * the original itself is missing — the caller's 404.
 */
export async function photoFileToServe(
  dir: string,
  filename: string,
  mimetype: string,
  variant: PhotoVariant
): Promise<{ filePath: string; type: string } | null> {
  const original = path.join(dir, path.basename(filename));
  if (!fs.existsSync(original)) return null;
  if (variant === "original" || !isHeifMimetype(mimetype)) {
    return { filePath: original, type: mimetype };
  }
  const rendition = path.join(dir, displayRenditionName(filename));
  if (fs.existsSync(rendition)) return { filePath: rendition, type: "image/jpeg" };
  return { filePath: await writeDisplayRendition(dir, filename), type: "image/jpeg" };
}
