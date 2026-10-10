import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";

import { FILE_LIMITS } from "../config/constants";
import { removeDisplayRendition } from "../services/photos/displayRendition";
import logger from "../utils/logger";
import { tripPhotoFilter } from "./upload";

/**
 * The photo of a standalone note (forgejo#137).
 *
 * Its own directory, like place and lodging photos: a note's photo dies with
 * its note, and a cleanup that first has to work out which rows point into a
 * shared folder is a cleanup nobody dares run. Registered in
 * `config/uploadDirs.ts`, which is the list the backup archives.
 *
 * One photo per note, so one file per request. Same type filter and size
 * limit as every other photo surface; HEIC is accepted and gets a JPEG display
 * copy on ingest.
 */
const NOTE_PHOTO_DIR = path.join(__dirname, "../../uploads/note-photos");

try {
  if (!fs.existsSync(NOTE_PHOTO_DIR)) fs.mkdirSync(NOTE_PHOTO_DIR, { recursive: true });
} catch (error: unknown) {
  logger.warn({
    operation: "upload_note_photo_dir_creation_failed",
    message: `Could not create note photo directory: ${NOTE_PHOTO_DIR}`,
    context: { error: error instanceof Error ? error.message : String(error) },
  });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, NOTE_PHOTO_DIR),
  // A generated name only: the client's file name never becomes a path.
  filename: (_req, file, cb) => {
    const ext = path
      .extname(file.originalname)
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, "");
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext.slice(0, 6)}`);
  },
});

export const uploadNotePhoto = multer({
  storage,
  fileFilter: tripPhotoFilter,
  limits: { fileSize: FILE_LIMITS.TRIP_PHOTO_MAX_SIZE, files: 1 },
});

export function getNotePhotoDir(): string {
  return NOTE_PHOTO_DIR;
}

/** Removes a note photo and its display copy; never throws (a leftover byte beats a failed delete). */
export function deleteNotePhotoFile(filename: string): void {
  removeDisplayRendition(NOTE_PHOTO_DIR, filename);
  const filePath = path.join(NOTE_PHOTO_DIR, path.basename(filename));
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    logger.warn({
      operation: "upload_note_photo_delete_error",
      message: "Failed to delete a note photo file",
      context: { filename: path.basename(filename) },
      error: { message: error instanceof Error ? error.message : "Unknown error" },
    });
  }
}
