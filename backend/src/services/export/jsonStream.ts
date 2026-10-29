import { createWriteStream } from "fs";
import { Readable, type Writable } from "stream";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";

import { withoutShareKeys } from "../sharing/wireGuard";

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

export type JsonReplacer = (key: string, value: unknown) => unknown;

/**
 * `toJSON` then the replacer, in JSON.stringify's order. The default replacer is
 * the app-wide one `res.json` applies (`index.ts`): a streamed export bypasses
 * `res.json`, so without it every `shareKey` would leave the server.
 */
function prepare(key: string, raw: unknown, replacer: JsonReplacer): unknown {
  let value = raw;
  if (
    !(value instanceof LazyArray) &&
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toJSON?: unknown }).toJSON === "function"
  ) {
    value = (value as { toJSON: (k: string) => unknown }).toJSON(key);
  }
  return replacer(key, value);
}

const dropped = (v: unknown) => v === undefined || typeof v === "function" || typeof v === "symbol";

/** JSON text of `value` in chunks; mirrors JSON.stringify (with replacer) for undefined/functions/toJSON. */
export async function* jsonChunks(
  input: unknown,
  replacer: JsonReplacer = withoutShareKeys
): AsyncGenerator<string> {
  yield* serialise(prepare("", input, replacer), replacer);
}

async function* serialise(value: unknown, replacer: JsonReplacer): AsyncGenerator<string> {
  if (value instanceof LazyArray) {
    yield "[";
    let index = 0;
    for await (const item of value.source()) {
      if (index > 0) yield ",";
      const prepared = prepare(String(index), item, replacer);
      yield* dropped(prepared) ? ["null"] : serialise(prepared, replacer);
      index++;
    }
    yield "]";
  } else if (Array.isArray(value)) {
    yield "[";
    for (let i = 0; i < value.length; i++) {
      if (i > 0) yield ",";
      const prepared = prepare(String(i), value[i], replacer);
      yield* dropped(prepared) ? ["null"] : serialise(prepared, replacer);
    }
    yield "]";
  } else if (typeof value === "object" && value !== null) {
    yield "{";
    let first = true;
    for (const [key, item] of Object.entries(value)) {
      const prepared = prepare(key, item, replacer);
      if (dropped(prepared)) continue;
      yield `${first ? "" : ","}${JSON.stringify(key)}:`;
      first = false;
      yield* serialise(prepared, replacer);
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
