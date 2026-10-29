import { createWriteStream } from "fs";
import { Readable, type Writable } from "stream";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";

/**
 * Streaming JSON for exports (forgejo#355). A large account holds more points
 * than V8 can stringify (~512 MB) and `gzipSync` on 100-300 MB blocks the event
 * loop, so the export writes the document out in pieces instead of building
 * one string.
 *
 * The output is byte-identical to `JSON.stringify` of the same structure with
 * every `LazyArray` replaced by the array it yields — importers see no change.
 * A `LazyArray` is re-iterable: `source()` is called once per serialisation.
 */
export class LazyArray<T> {
  constructor(readonly source: () => AsyncIterable<T> | Iterable<T>) {}

  /** Materialise it — for tests and small callers only. */
  async toArray(): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this.source()) out.push(item);
    return out;
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  typeof (v as { toJSON?: unknown }).toJSON !== "function";

/** JSON text of `value` in chunks; mirrors JSON.stringify's rules for undefined/functions. */
export async function* jsonChunks(value: unknown): AsyncGenerator<string> {
  if (value instanceof LazyArray) {
    yield "[";
    let first = true;
    for await (const item of value.source()) {
      if (!first) yield ",";
      first = false;
      yield* jsonChunks(item === undefined ? null : item);
    }
    yield "]";
  } else if (Array.isArray(value)) {
    yield "[";
    for (let i = 0; i < value.length; i++) {
      if (i > 0) yield ",";
      const item = value[i];
      yield* jsonChunks(item === undefined || typeof item === "function" ? null : item);
    }
    yield "]";
  } else if (isPlainObject(value)) {
    yield "{";
    let first = true;
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
      yield `${first ? "" : ","}${JSON.stringify(key)}:`;
      first = false;
      yield* jsonChunks(item);
    }
    yield "}";
  } else {
    yield JSON.stringify(value) ?? "null";
  }
}

/** Batch small pieces so a socket/gzip sees few large writes, not millions of tiny ones. */
async function* batched(
  source: AsyncIterable<string> | Iterable<string>,
  limit = 64 * 1024
): AsyncGenerator<string> {
  let buf = "";
  for await (const piece of source) {
    buf += piece;
    if (buf.length >= limit) {
      yield buf;
      buf = "";
    }
  }
  if (buf) yield buf;
}

/** A Readable of the document's JSON text. An error thrown mid-way destroys it. */
export function jsonReadable(value: unknown): Readable {
  return Readable.from(batched(jsonChunks(value)), { objectMode: false });
}

/** Stream the document gzipped into a file; rejects (leaving the file for the caller to remove) on any error. */
export async function writeJsonGzipFile(value: unknown, filePath: string): Promise<void> {
  await pipeline(jsonReadable(value), createGzip(), createWriteStream(filePath));
}

/** Stream the document into an HTTP response; rejects on error after the response was aborted. */
export function pipeJsonToResponse(value: unknown, res: Writable): Promise<void> {
  return pipeTextToResponse(jsonChunks(value), res);
}

/**
 * Stream text pieces into a response with back-pressure. A failure after the
 * first byte cannot become an error page (the headers are out), so the
 * connection is destroyed: the client sees a broken download, never a file that
 * looks complete (forgejo#355, forgejo#357).
 */
export async function pipeTextToResponse(
  source: AsyncIterable<string> | Iterable<string>,
  res: Writable
): Promise<void> {
  try {
    await pipeline(Readable.from(batched(source), { objectMode: false }), res);
  } catch (error) {
    if (!res.destroyed) res.destroy(error as Error);
    throw error;
  }
}
