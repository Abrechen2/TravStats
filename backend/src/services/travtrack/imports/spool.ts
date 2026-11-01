import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request } from "express";
import type { StorageEngine } from "multer";

import { AppError } from "../../../middleware/errorHandler";
import logger from "../../../utils/logger";
import { sniffFormat, XML_IMPORT_MAX_BYTES } from "./trackFormat";

/**
 * Where an uploaded track file waits (forgejo#394, security review): on disk,
 * not in memory. A 200 MB `Records.json` held as a Buffer per request let a
 * handful of parallel uploads exhaust the server; a file in the temp directory
 * costs the disk, and the child that reads it opens it by path.
 *
 * The directory is the system's temp directory, not `uploads/`: these files
 * live for the length of one import, belong in no backup, and a leftover of a
 * crash is swept (older than a day) the first time the directory is used.
 *
 * The upload is judged WHILE it streams in: the first bytes name the format,
 * and a file that is not JSON is aborted with 413 the moment it passes the XML
 * cap, instead of after 200 MB have been taken.
 */

export const SPOOL_DIR = path.join(os.tmpdir(), "travstats-travtrack-imports");
const STALE_MS = 24 * 3600_000;
const HEAD_BYTES = 4096;
let swept = false;

function ensureDir(): void {
  fs.mkdirSync(SPOOL_DIR, { recursive: true, mode: 0o700 });
  if (swept) return;
  swept = true;
  try {
    for (const name of fs.readdirSync(SPOOL_DIR)) {
      const file = path.join(SPOOL_DIR, name);
      if (Date.now() - fs.statSync(file).mtimeMs > STALE_MS) fs.rmSync(file, { force: true });
    }
  } catch (err) {
    logger.warn({
      operation: "travtrack.import.spool_sweep_failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function newSpoolPath(): string {
  ensureDir();
  return path.join(SPOOL_DIR, `${randomUUID()}.upload`);
}

/** Removes a spooled file; a file already gone is fine. */
export function discardSpool(file: string | undefined | null): void {
  if (!file) return;
  try {
    fs.rmSync(file, { force: true });
  } catch (err) {
    logger.warn({
      operation: "travtrack.import.spool_discard_failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** A buffer as a spooled file (callers that already hold the bytes, e.g. tests). */
export async function spoolBuffer(buffer: Buffer): Promise<string> {
  const file = newSpoolPath();
  await fs.promises.writeFile(file, buffer, { mode: 0o600 });
  return file;
}

/** The first bytes of a file. */
export async function readHead(file: string): Promise<Buffer> {
  const handle = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Multer storage: streams the part into the spool directory, sniffing its head
 * and aborting a non-JSON file past the XML cap. The stored file is
 * `{ path, size }` on `req.file`.
 */
export function spoolStorage(opts: { xmlCap?: number } = {}): StorageEngine {
  const xmlCap = opts.xmlCap ?? XML_IMPORT_MAX_BYTES;
  return {
    _handleFile(_req: Request, file, cb) {
      const target = newSpoolPath();
      let received = 0;
      let headLen = 0;
      const head: Buffer[] = [];
      let json: boolean | null = null;
      const decide = () => {
        json = sniffFormat(Buffer.concat(head)) === "json";
      };
      const guard = new Transform({
        transform(chunk: Buffer, _enc, done) {
          received += chunk.length;
          if (json === null) {
            head.push(chunk);
            headLen += chunk.length;
            if (headLen >= HEAD_BYTES) decide();
          }
          if (json === false && received > xmlCap) {
            return done(new AppError("The file is too large", 413, "TRACK_FILE_TOO_LARGE"));
          }
          done(null, chunk);
        },
        flush(done) {
          if (json === null) decide();
          done();
        },
      });
      pipeline(file.stream, guard, fs.createWriteStream(target, { mode: 0o600 })).then(
        () => cb(null, { path: target, size: received } as Partial<Express.Multer.File>),
        (err: unknown) => {
          discardSpool(target);
          cb(err);
        }
      );
    },
    _removeFile(_req, file, cb) {
      discardSpool(file.path);
      cb(null);
    },
  };
}
