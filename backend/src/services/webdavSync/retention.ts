import path from "path";
import type { createClient } from "webdav";

/**
 * The clean-up after an upload (forgejo#321), bounded in what it reads and
 * what it does: a folder of a hundred thousand files, or a share answering
 * a listing with gigabytes, must not turn a nightly backup into unbounded
 * outbound work (Codex review). The run's deadline bounds the time; this file
 * bounds the bytes and the deletions.
 */

type Client = ReturnType<typeof createClient>;

/** The most of a folder listing we read; ~2,000 entries of a typical share. */
export const MAX_LISTING_BYTES = 1024 * 1024;
/** The most old exports one run deletes; the rest wait for the next run. */
export const MAX_DELETIONS_PER_RUN = 20;

export interface PruneOutcome {
  deleted: number;
  /** False when the listing was too large to read or more were due than one run deletes. */
  complete: boolean;
}

/**
 * The body as text, or null once it passes `max` bytes. Leaving the loop
 * early cancels the stream, so the rest is never downloaded. The client's
 * fetch is node-fetch (a Node stream body); a web stream iterates the same way.
 */
async function readCapped(
  body: AsyncIterable<Uint8Array | string> | null,
  max: number
): Promise<string | null> {
  if (!body) return "";
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const bytes = Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > max) return null;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const RESPONSE = /<(?:[\w.-]+:)?response[\s>]/i;
const HREF = /<(?:[\w.-]+:)?href[^>]*>([^<]*)</i;
const COLLECTION = /<(?:[\w.-]+:)?collection[\s/>]/i;

/**
 * The file names in a PROPFIND Depth 1 answer; folders left out, so a folder
 * that happens to carry an export's name is never deleted (a DELETE on a
 * collection removes everything in it). Read with patterns rather than the
 * package's parser because that one only takes a fully read body; the names
 * retention acts on are ours and carry no markup, so nothing else needs to
 * survive the reading.
 */
export function listedFileNames(xml: string): string[] {
  const names: string[] = [];
  for (const entry of xml.split(RESPONSE).slice(1)) {
    const href = HREF.exec(entry)?.[1]?.trim();
    if (!href || COLLECTION.test(entry)) continue;
    const last = href.replace(/\/+$/, "").split("/").pop() ?? "";
    try {
      names.push(decodeURIComponent(last.replace(/&amp;/g, "&")));
    } catch {
      // Not percent-encoded validly, so not a name we wrote.
    }
  }
  return names;
}

/** Delete all but the newest `keep` of the files `pattern` matches, within the bounds. */
export async function pruneOwnExports(
  client: Client,
  remotePath: string,
  pattern: RegExp,
  keep: number,
  signal: () => AbortSignal
): Promise<PruneOutcome> {
  const response = await client.customRequest(path.posix.join(remotePath, "/"), {
    method: "PROPFIND",
    headers: { Depth: "1", Accept: "application/xml, text/xml" },
    signal: signal(),
  });
  const body = response.body as unknown as AsyncIterable<Uint8Array | string> | null;
  const xml = await readCapped(body, MAX_LISTING_BYTES);
  if (xml === null) return { deleted: 0, complete: false };

  const due = listedFileNames(xml)
    .filter((name) => pattern.test(name))
    .sort()
    .reverse()
    .slice(keep);
  let deleted = 0;
  for (const name of due.slice(0, MAX_DELETIONS_PER_RUN)) {
    await client.deleteFile(path.posix.join(remotePath, name), { signal: signal() });
    deleted += 1;
  }
  return { deleted, complete: due.length <= MAX_DELETIONS_PER_RUN };
}
