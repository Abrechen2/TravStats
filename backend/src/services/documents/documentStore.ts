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
 * The stored name is generated (`<uuid><ext>`) and every path is rebuilt from
 * this directory plus `path.basename` of it, never from anything the client
 * sent.
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

export function newStoredName(extension: string): string {
  return `${crypto.randomUUID()}${extension}`;
}

export async function writeDocumentFile(storedName: string, buffer: Buffer): Promise<void> {
  ensureDocumentDir();
  // `wx`: never overwrite — a collision on a fresh UUID would be a bug, not a replace.
  await fsp.writeFile(documentPath(storedName), buffer, { flag: "wx" });
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

/**
 * How long ago a stored file was last written, or null when it is gone. The
 * orphan sweep needs it: a file with no row may be an upload whose row is being
 * inserted right now.
 */
export async function documentFileAgeMs(
  storedName: string,
  now = Date.now()
): Promise<number | null> {
  try {
    return now - (await fsp.stat(documentPath(storedName))).mtimeMs;
  } catch {
    return null;
  }
}

/** Every stored name currently on disk — for the orphan sweep. */
export async function listStoredNames(): Promise<string[]> {
  try {
    return await fsp.readdir(DOCUMENT_DIR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
