import { createHash, randomBytes } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";

import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { detectFileTypeFromBuffer } from "../../utils/fileValidation";
import { checkDocumentFormat } from "../documents/documentService";
import { DOCUMENT_MAX_BYTES, detectDocumentFormat } from "../documents/documentFormats";
import { profilePictureFileNameFromUrl } from "../files/privateFileUrls";
import type { ArchiveContents } from "./importValidate";
import { importedFileName, type Remapper } from "./remap";
import type { FileColumn } from "./tablePolicy";
import type { ArchiveReader } from "./zipReader";

/**
 * The files of an imported account (forgejo#433). An archive is untrusted input,
 * so a file only lands when the upload path would have accepted it: its type is
 * read from its bytes with the same detectors the uploads use (documents through
 * `checkDocumentFormat`, photos and receipts by their magic numbers), never taken
 * from the archive's rows. A file that fails is not written, and a row naming it
 * is refused (`importRows.ts`), so nothing is ever served under a type the upload
 * path would refuse.
 */

const HEAD_BYTES = 4096;
const IMAGES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic"]);
const ACCEPTED: Record<string, ReadonlySet<string>> = {
  receipts: new Set([...IMAGES, "application/pdf"]),
};
/** A HEIC original's JPEG rendition sits beside it (`photos/displayRendition.ts`). */
const RENDITION = ".display.jpg";

export interface FileVerdict {
  mimetype: string;
  format?: string;
  sha256: string;
  size: number;
}

export interface WrittenFile {
  path: string;
}

function imageType(head: Buffer, name: string): string | null {
  const magic = detectFileTypeFromBuffer(head);
  if (magic) return magic === "image/jpg" ? "image/jpeg" : magic;
  const detected = detectDocumentFormat(head, name, undefined);
  return detected?.format === "image" ? detected.mimetype : null;
}

async function judge(
  dir: string,
  name: string,
  target: string,
  head: Buffer,
  sha256: string,
  size: number
) {
  if (dir === "documents") {
    if (size > DOCUMENT_MAX_BYTES) return null;
    try {
      const detected = checkDocumentFormat({
        buffer: await fsp.readFile(target),
        originalName: name,
      });
      return { mimetype: detected.mimetype, format: detected.format, sha256, size };
    } catch {
      return null;
    }
  }
  const type = imageType(head, name);
  if (!type) return null;
  if (name.endsWith(RENDITION) && type !== "image/jpeg") return null;
  return (ACCEPTED[dir] ?? IMAGES).has(type) ? { mimetype: type, sha256, size } : null;
}

async function choosePrefix(
  root: string,
  contents: ArchiveContents,
  remap: Remapper
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const prefix = `a${randomBytes(4).toString("hex")}`;
    const clashes = await Promise.all(
      contents.files.map((f) =>
        fsp
          .access(
            path.join(
              root,
              f.dir,
              importedFileName(f.dir, f.name, prefix, remap.targetUserId, remap.sourceUserId)
            )
          )
          .then(() => true)
          .catch(() => false)
      )
    );
    if (!clashes.some(Boolean)) return prefix;
  }
  throw new AppError("Could not choose free file names", 500, "ACCOUNT_ARCHIVE_INVALID");
}

/**
 * Writes every acceptable file under its new name and returns the verdicts by new
 * name. `written` collects every path touched, for the caller's cleanup.
 */
export async function writeFiles(
  reader: ArchiveReader,
  contents: ArchiveContents,
  remap: Remapper,
  root: string,
  written: WrittenFile[],
  tick: () => void
): Promise<{ verdicts: Map<string, FileVerdict>; refused: number }> {
  const prefix = await choosePrefix(root, contents, remap);
  const verdicts = new Map<string, FileVerdict>();
  let refused = 0;
  for (const file of contents.files) {
    const newName = importedFileName(
      file.dir,
      file.name,
      prefix,
      remap.targetUserId,
      remap.sourceUserId
    );
    const dir = path.join(root, file.dir);
    await fsp.mkdir(dir, { recursive: true });
    const target = path.join(dir, newName);
    const hash = createHash("sha256");
    const head: Buffer[] = [];
    let size = 0;
    written.push({ path: target });
    await pipeline(
      await reader.stream(file.entry),
      new Transform({
        transform(chunk: Buffer, _enc, done) {
          hash.update(chunk);
          if (size < HEAD_BYTES) head.push(chunk.subarray(0, HEAD_BYTES - size));
          size += chunk.length;
          done(null, chunk);
        },
      }),
      fs.createWriteStream(target, { flags: "wx", mode: 0o644 })
    );
    const sha256 = hash.digest("hex");
    if (sha256 !== file.sha256) {
      throw new AppError(
        `${file.entry} does not match its checksum`,
        422,
        "ACCOUNT_ARCHIVE_CHECKSUM"
      );
    }
    const verdict = await judge(file.dir, file.name, target, Buffer.concat(head), sha256, size);
    if (verdict) {
      remap.setFile(file.name, newName);
      verdicts.set(verdictKey(file.dir, newName), verdict);
    } else {
      refused += 1;
      logger.warn({ operation: "account_archive_file_refused", dir: file.dir });
      await fsp.rm(target, { force: true });
    }
    tick();
  }
  return { verdicts, refused };
}

export async function removeFiles(written: readonly WrittenFile[]): Promise<void> {
  for (const file of written) {
    await fsp.rm(file.path, { force: true }).catch((err: unknown) => {
      logger.warn({
        operation: "account_archive_import_cleanup_failed",
        file: path.basename(file.path),
        error: String(err),
      });
    });
  }
}

/** Verdicts are per directory: one name may exist in two of them. */
export const verdictKey = (dir: string, name: string): string => `${dir}/${name}`;

/** The row cannot be imported without its file. */
export class MissingFile extends Error {}

/**
 * Holds a row's file columns to the files that actually landed: type, digest and
 * size come from the bytes; a name with no accepted file clears a nullable column
 * and refuses the row otherwise. Mutates `row` (a fresh object of the caller's).
 */
export function checkFileColumns(
  row: Record<string, unknown>,
  rules: readonly FileColumn[],
  verdicts: ReadonlyMap<string, FileVerdict>,
  nullable: (column: string) => boolean
): void {
  for (const rule of rules) {
    const value = row[rule.column];
    if (value === null || value === undefined) continue;
    if (rule.kind === "avatar") {
      const profile = (value as { profile?: Record<string, unknown> }).profile;
      const url = typeof profile?.profilePicture === "string" ? profile.profilePicture : null;
      const name = profilePictureFileNameFromUrl(url);
      if (url && name && !verdicts.has(verdictKey(rule.dir, name)) && profile) {
        delete profile.profilePicture;
      }
      continue;
    }
    if (rule.linkedWhen?.some((c) => row[c] !== null && row[c] !== undefined)) continue;
    const name = path.basename(String(value));
    const verdict = verdicts.get(verdictKey(rule.dir, name));
    if (rule.kind === "url") {
      if (String(value).startsWith("/api/") && !verdict) row[rule.column] = null;
      continue;
    }
    if (!verdict) {
      if (nullable(rule.column)) {
        row[rule.column] = null;
        if (rule.mime && nullable(rule.mime)) row[rule.mime] = null;
        continue;
      }
      throw new MissingFile(`${rule.column} names no accepted file`);
    }
    if (rule.mime) row[rule.mime] = verdict.mimetype;
    if (rule.format && verdict.format) row[rule.format] = verdict.format;
    if (rule.sha256) row[rule.sha256] = verdict.sha256;
    if (rule.size) row[rule.size] = verdict.size;
  }
}
