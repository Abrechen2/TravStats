import path from "path";
import type { createClient } from "webdav";

/**
 * The clean-up after an upload (forgejo#321).
 *
 * WHAT may be deleted is decided by the account's own record, never by the
 * share: only names this account recorded as successfully uploaded
 * (`UserWebdavSync.uploadedFiles`). A listing can repeat an entry (a proxy, a
 * buggy server), carry response-like text in comments, or show files a cloned
 * instance with the same owner tag wrote — trusting it once deleted the
 * newest, only backup (Codex review). The listing is used for one thing: to
 * confirm which recorded names still exist. A recorded name the share no
 * longer has is dropped from the record without a DELETE.
 *
 * HOW MUCH is bounded too: a listing is read up to MAX_LISTING_BYTES and a run
 * deletes at most MAX_DELETIONS_PER_RUN; the run's deadline bounds the time.
 */

type Client = ReturnType<typeof createClient>;

/** The most of a folder listing we read; ~2,000 entries of a typical share. */
export const MAX_LISTING_BYTES = 1024 * 1024;
/** The most old exports one run deletes; the rest wait for the next run. */
export const MAX_DELETIONS_PER_RUN = 20;
/**
 * How many uploaded names the record holds. Retention keeps it near
 * `keepVersions` (at most 30), so this is only reached when deletions keep
 * failing; a name pushed off the end is never deleted — the safe direction.
 */
export const MAX_HISTORY = 100;

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

const COMMENTS_AND_CDATA = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;
const RESPONSE = /<(?:[\w.-]+:)?response[\s>]/i;
const HREF = /<(?:[\w.-]+:)?href[^>]*>([^<]*)</i;
const COLLECTION = /<(?:[\w.-]+:)?collection[\s/>]/i;

/**
 * The file names in a PROPFIND Depth 1 answer, as a set; folders left out.
 * Read with patterns rather than the package's parser because that one only
 * takes a fully read body. Comments and CDATA are removed first so text inside
 * them is not read as an entry; no DTD or entity is ever expanded. The names
 * looked up are ours and carry no markup, and the set only CONFIRMS a recorded
 * name — it never adds one to what may be deleted.
 */
export function listedFileNames(xml: string): Set<string> {
  const names = new Set<string>();
  for (const entry of xml.replace(COMMENTS_AND_CDATA, "").split(RESPONSE).slice(1)) {
    const href = HREF.exec(entry)?.[1]?.trim();
    if (!href || COLLECTION.test(entry)) continue;
    const last = href.replace(/\/+$/, "").split("/").pop() ?? "";
    try {
      names.add(decodeURIComponent(last.replace(/&amp;/g, "&")));
    } catch {
      // Not percent-encoded validly, so not a name we wrote.
    }
  }
  return names;
}

/** The folder's file names, or null when the listing is too large to read. */
async function listFolder(
  client: Client,
  remotePath: string,
  signal: AbortSignal
): Promise<Set<string> | null> {
  const response = await client.customRequest(path.posix.join(remotePath, "/"), {
    method: "PROPFIND",
    headers: { Depth: "1", Accept: "application/xml, text/xml" },
    signal,
  });
  const body = response.body as unknown as AsyncIterable<Uint8Array | string> | null;
  const xml = await readCapped(body, MAX_LISTING_BYTES);
  return xml === null ? null : listedFileNames(xml);
}

/** `name` first, then `history` without it; no repeats, bounded. */
export function recordUpload(history: readonly string[], name: string): string[] {
  return [name, ...new Set(history.filter((n) => n !== name))].slice(0, MAX_HISTORY);
}

export interface RetentionPlan {
  /** Recorded names to delete this run, oldest first. */
  delete: string[];
  /** The record after the plan, before any deletion succeeded. */
  history: string[];
  /** False when more were due than one run deletes. */
  complete: boolean;
}

/**
 * Pure: which recorded names go. `history` is newest first and starts with
 * the upload just made, which is always kept whatever the listing says.
 * `present` null (listing unreadable) changes nothing and deletes nothing.
 */
export function planRetention(
  history: readonly string[],
  present: ReadonlySet<string> | null,
  keep: number,
  own: RegExp
): RetentionPlan {
  const unique = [...new Set(history)];
  if (!present) return { delete: [], history: unique, complete: false };
  const [newest, ...rest] = unique;
  const existing = newest === undefined ? [] : [newest, ...rest.filter((n) => present.has(n))];
  const due = existing
    .slice(Math.max(keep, 1))
    .filter((name) => own.test(name))
    .reverse();
  return {
    delete: due.slice(0, MAX_DELETIONS_PER_RUN),
    history: existing,
    complete: due.length <= MAX_DELETIONS_PER_RUN,
  };
}

export interface PruneOutcome {
  deleted: number;
  /** The record to store: what still exists, minus what this run deleted. */
  history: string[];
  /** False when the listing was too large to read or more were due than one run deletes. */
  complete: boolean;
}

/**
 * Delete the recorded exports beyond the newest `keep`. A failing DELETE is
 * thrown — with `progress` holding what was already done, so the record
 * still loses the names that are gone.
 */
export async function pruneOwnExports(
  client: Client,
  remotePath: string,
  history: readonly string[],
  keep: number,
  own: RegExp,
  signal: () => AbortSignal,
  progress: { history: string[]; deleted: number }
): Promise<PruneOutcome> {
  const present = await listFolder(client, remotePath, signal());
  const plan = planRetention(history, present, keep, own);
  progress.history = plan.history;
  for (const name of plan.delete) {
    try {
      await client.deleteFile(path.posix.join(remotePath, name), { signal: signal() });
      progress.deleted += 1;
    } catch (error) {
      // Gone since the listing: nothing to delete, and nothing to remember.
      if ((error as { status?: unknown } | null)?.status !== 404) throw error;
    }
    progress.history = progress.history.filter((n) => n !== name);
  }
  return { deleted: progress.deleted, history: progress.history, complete: plan.complete };
}
