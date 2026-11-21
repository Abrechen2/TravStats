import { createHash } from "crypto";
import { createInterface } from "readline";
import type { Readable } from "stream";
import yauzl from "yauzl";

import { AppError } from "../../middleware/errorHandler";

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

  static async open(file: string): Promise<ArchiveReader> {
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
    const entries = new Map<string, yauzl.Entry>();
    try {
      await new Promise<void>((resolve, reject) => {
        zip.on("entry", (entry: yauzl.Entry) => {
          if (entry.fileName.endsWith("/")) {
            zip.readEntry();
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

  /** The entry's lines, parsed; an unparsable line is an invalid archive. */
  async *jsonLines(name: string): AsyncGenerator<Record<string, unknown>> {
    const lines = createInterface({ input: await this.stream(name), crlfDelay: Infinity });
    for await (const line of lines) {
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
