import { createHash } from "crypto";
import type { Readable } from "stream";
import yauzl from "yauzl";

import { AppError } from "../../middleware/errorHandler";
import { MAX_ARCHIVE_ENTRIES } from "./format";

/**
 * The longest single row a data entry may carry. A flight's recorded track is the
 * largest row there is (a few MB); a line past this is not a row but an attack on
 * the reader's memory, and the whole archive is refused.
 */
export const MAX_LINE_BYTES = 32 * 1024 * 1024;

/**
 * Read access to an uploaded account archive. yauzl reads the central directory,
 * so an entry is opened by name in any order, and it validates every entry's
 * declared size while streaming (a ZIP bomb runs into its own header).
 */

export function invalidArchive(message: string): AppError {
  return new AppError(message, 422, "ACCOUNT_ARCHIVE_INVALID");
}

export class ArchiveReader {
  private constructor(
    private readonly zip: yauzl.ZipFile,
    readonly entries: ReadonlyMap<string, yauzl.Entry>
  ) {}

  static async open(file: string, maxEntries = MAX_ARCHIVE_ENTRIES): Promise<ArchiveReader> {
    let zip: yauzl.ZipFile;
    try {
      zip = await yauzl.openPromise(file, {
        lazyEntries: true,
        autoClose: false,
        strictFileNames: true,
        validateEntrySizes: true,
      });
    } catch {
      throw invalidArchive("Not a ZIP archive");
    }
    if (zip.entryCount > maxEntries + 1) {
      zip.close();
      throw invalidArchive("The archive holds too many entries");
    }
    const entries = new Map<string, yauzl.Entry>();
    try {
      await new Promise<void>((resolve, reject) => {
        zip.on("entry", (entry: yauzl.Entry) => {
          if (entry.fileName.endsWith("/")) {
            zip.readEntry();
            return;
          }
          // The manifest plus its entries; more is refused before it fills memory.
          if (entries.size > maxEntries) {
            reject(invalidArchive("The archive holds too many entries"));
            return;
          }
          if (entries.has(entry.fileName)) {
            reject(invalidArchive(`Duplicate entry ${entry.fileName}`));
            return;
          }
          entries.set(entry.fileName, entry);
          zip.readEntry();
        });
        zip.on("end", resolve);
        zip.on("error", reject);
        zip.readEntry();
      });
    } catch (err) {
      zip.close();
      throw err instanceof AppError ? err : invalidArchive("The ZIP archive is damaged");
    }
    return new ArchiveReader(zip, entries);
  }

  close(): void {
    this.zip.close();
  }

  async stream(name: string): Promise<Readable> {
    const entry = this.entries.get(name);
    if (!entry) throw invalidArchive(`Missing entry ${name}`);
    return this.zip.openReadStreamPromise(entry);
  }

  async readJson(name: string, maxBytes: number): Promise<unknown> {
    const entry = this.entries.get(name);
    if (!entry) throw invalidArchive(`Missing entry ${name}`);
    if (entry.uncompressedSize > maxBytes) throw invalidArchive(`${name} is too large`);
    const chunks: Buffer[] = [];
    for await (const chunk of await this.stream(name)) chunks.push(chunk as Buffer);
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    } catch {
      throw invalidArchive(`${name} is not JSON`);
    }
  }

  /** The entry's sha256 and length, read in full. */
  async digest(name: string): Promise<{ sha256: string; bytes: number }> {
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of await this.stream(name)) {
      hash.update(chunk as Buffer);
      bytes += (chunk as Buffer).length;
    }
    return { sha256: hash.digest("hex"), bytes };
  }

  /** The entry's lines, parsed; an unparsable or over-long line is an invalid archive. */
  async *jsonLines(name: string): AsyncGenerator<Record<string, unknown>> {
    for await (const line of splitLines(await this.stream(name), name)) {
      if (!line) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw invalidArchive(`${name} holds a line that is not JSON`);
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalidArchive(`${name} holds a line that is not a row`);
      }
      yield value as Record<string, unknown>;
    }
  }
}

/** Lines of a stream, never buffering more than `maxBytes` of one line. */
export async function* splitLines(
  stream: AsyncIterable<Buffer | string>,
  name: string,
  maxBytes = MAX_LINE_BYTES
): AsyncGenerator<string> {
  let parts: Buffer[] = [];
  let held = 0;
  for await (const raw of stream) {
    let chunk = typeof raw === "string" ? Buffer.from(raw) : raw;
    for (let nl = chunk.indexOf(10); nl >= 0; nl = chunk.indexOf(10)) {
      if (held + nl > maxBytes) throw invalidArchive(`${name} holds a line that is too long`);
      parts.push(chunk.subarray(0, nl));
      yield Buffer.concat(parts).toString("utf-8");
      parts = [];
      held = 0;
      chunk = chunk.subarray(nl + 1);
    }
    held += chunk.length;
    if (held > maxBytes) throw invalidArchive(`${name} holds a line that is too long`);
    if (chunk.length > 0) parts.push(chunk);
  }
  if (held > 0) yield Buffer.concat(parts).toString("utf-8");
}
