import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

import { UPLOADS_ROOT } from "../../config/uploadDirs";
import logger from "../../utils/logger";

/**
 * Where kept originals live on disk: `uploads/documents/<storedName>`.
 *
 * Registered in config/uploadDirs.ts, which is what puts the directory into the
 * backup archive — a directory missing from that list once cost every photo's
 * bytes on restore.
 *
 * The stored name is the content's sha256 plus its extension, and every path
 * is rebuilt from this directory plus `path.basename` of it, never from
 * anything the client sent. Naming by content is what lets one booking mail
 * filed with four flights be four rows over ONE file: until 2026-10-16 every
 * row got a fresh `<uuid><ext>`, and prod held 19 contents in 49 files. A file
 * named this way may therefore be shared — by rows of one entry type, of
 * several, or of several accounts — and is removed only once no row names it
 * (`releaseDocumentFiles` in documentService.ts). Rows written before that day
 * keep their uuid names; both kinds are served the same way.
 */
export const DOCUMENT_DIR = path.join(UPLOADS_ROOT, "documents");

export function ensureDocumentDir(): void {
  if (!fs.existsSync(DOCUMENT_DIR)) fs.mkdirSync(DOCUMENT_DIR, { recursive: true });
}

export function documentPath(storedName: string): string {
  return path.join(DOCUMENT_DIR, path.basename(storedName));
}

export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** The name a content is stored under — the same bytes always get the same name. */
export function storedNameFor(sha256: string, extension: string): string {
  return `${sha256}${extension}`;
}

/**
 * Makes sure the file is on disk. A file already there under a content name
 * holds these very bytes, so it is left as it is rather than rewritten.
 */
export async function writeDocumentFile(storedName: string, buffer: Buffer): Promise<void> {
  ensureDocumentDir();
  try {
    // `wx`: never overwrite — another row may be reading this file right now.
    await fsp.writeFile(documentPath(storedName), buffer, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
    throw error;
  }
}

/** Removes a stored file. A file that is already gone is not an error. */
export async function removeDocumentFile(storedName: string): Promise<void> {
  try {
    await fsp.unlink(documentPath(storedName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    // Logged by stored name only — never the user's file name or content.
    logger.warn(
      {
        operation: "document_file_remove_failed",
        storedName,
        error: { message: (error as Error).message },
      },
      "Could not remove a document file; the nightly sweep will retry"
    );
  }
}
