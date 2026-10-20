/**
 * Polite access to Wikidata and Wikimedia Commons for operator marks
 * (forgejo#323) — server side only; the browser never talks to Wikimedia.
 *
 * Wikimedia's API etiquette asks for a User-Agent that names the client and a
 * way to reach its maintainer (the open data one, `OPEN_DATA_USER_AGENT`), for
 * requests made one at a time rather than in parallel, and for backing off
 * when told to. So every request here goes through ONE queue with a minimum
 * gap between calls, and a 429 or a `maxlag` error pauses the queue for the
 * time the server asked for (Retry-After) before anyone asks again.
 *
 * Every call says WHY it failed — the caller logs the reason and falls back
 * to the monogram; nothing here throws.
 */
import { OPEN_DATA_USER_AGENT } from "../openData/http";

export type WikimediaFailure = "rateLimited" | "timeout" | "unavailable" | "notFound" | "tooLarge";

export type WikimediaResult<T> = { ok: true; value: T } | { ok: false; reason: WikimediaFailure };

const TIMEOUT_MS = 8_000;
/** At most ~4 requests a second, one at a time. */
const MIN_GAP_MS = 250;
/** When a 429 carries no Retry-After, wait this long. */
const DEFAULT_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;
/** A search or entity answer is a few KiB; anything near this is not one. */
export const MAX_JSON_BYTES = 2 * 1024 * 1024;
/** A 128 px logo thumbnail is a few KiB. */
export const MAX_IMAGE_BYTES = 512 * 1024;

let queue: Promise<unknown> = Promise.resolve();
let nextSlotAt = 0;
let pausedUntil = 0;

/** Test seam: an empty queue, no pause. */
export function __resetWikimediaQueueForTests(): void {
  queue = Promise.resolve();
  nextSlotAt = 0;
  pausedUntil = 0;
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

function backoffOf(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, MAX_BACKOFF_MS)
    : DEFAULT_BACKOFF_MS;
}

/** Run `task` in the single queue, after the minimum gap. Rejects nothing. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    await sleep(Math.max(nextSlotAt, 0) - Date.now());
    nextSlotAt = Date.now() + MIN_GAP_MS;
    return task();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function request(url: string, accept: string): Promise<WikimediaResult<Response>> {
  if (Date.now() < pausedUntil) return { ok: false, reason: "rateLimited" };
  return enqueue(async () => {
    if (Date.now() < pausedUntil) return { ok: false, reason: "rateLimited" } as const;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": OPEN_DATA_USER_AGENT, Accept: accept },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 429) {
        pausedUntil = Date.now() + backoffOf(res.headers.get("retry-after"));
        return { ok: false, reason: "rateLimited" } as const;
      }
      if (res.status === 404) return { ok: false, reason: "notFound" } as const;
      if (!res.ok) return { ok: false, reason: "unavailable" } as const;
      return { ok: true, value: res } as const;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      return {
        ok: false,
        reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable",
      } as const;
    }
  });
}

/**
 * The body, read with a running byte count: past `limit` the stream is
 * cancelled — which aborts the download — and the answer is `tooLarge`.
 * Buffering first and measuring after would let one hostile or broken
 * answer take as much memory as it likes.
 */
export async function readCapped(res: Response, limit: number): Promise<WikimediaResult<Buffer>> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, reason: "tooLarge" };
  }
  if (!res.body) return { ok: true, value: Buffer.alloc(0) };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "tooLarge" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, value: Buffer.concat(chunks) };
}

/** GET a MediaWiki API URL as JSON. `maxlag` errors count as rate limiting. */
export async function getJson(url: string): Promise<WikimediaResult<unknown>> {
  const res = await request(url, "application/json");
  if (!res.ok) return res;
  const raw = await readCapped(res.value, MAX_JSON_BYTES);
  if (!raw.ok) return raw;
  try {
    const body = JSON.parse(raw.value.toString("utf-8")) as { error?: { code?: string } };
    if (body?.error?.code === "maxlag") {
      pausedUntil = Date.now() + backoffOf(res.value.headers.get("retry-after"));
      return { ok: false, reason: "rateLimited" };
    }
    return { ok: true, value: body };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** GET image bytes, capped at `MAX_IMAGE_BYTES`. The caller checks the type. */
export async function getBytes(
  url: string
): Promise<WikimediaResult<{ body: Buffer; contentType: string }>> {
  const res = await request(url, "image/png,image/jpeg,image/webp,image/gif");
  if (!res.ok) return res;
  const contentType = (res.value.headers.get("content-type") ?? "").split(";")[0].trim();
  const body = await readCapped(res.value, MAX_IMAGE_BYTES);
  return body.ok ? { ok: true, value: { body: body.value, contentType } } : body;
}
