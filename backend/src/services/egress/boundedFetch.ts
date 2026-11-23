/**
 * One outbound HTTP request with every bound an untrusted target needs
 * (spec 2026-11-23-plugins-and-calendar.md, security review): the forgejo#411
 * address rule with DNS pinned per socket, no redirects followed, a total
 * time cap, and a cap on the bytes read AFTER decompression — a gzip bomb
 * is counted by what it inflates to, not by what crossed the wire.
 *
 * Used by the calendar source (ICS, CalDAV) and the suggestion plugins. The
 * answer is the raw status and body; what a status means is the caller's
 * vocabulary. Every failure to get an answer is one of a fixed set of reasons,
 * never a thrown string.
 */
import {
  PrivateTargetError,
  assertTargetAllowed,
  fetchDispatcherFor,
  isPrivateTargetRefusal,
  type TargetPolicy,
} from "./privateTargets";

export type BoundedFetchFailure =
  /** The URL names a target this caller may not reach (forgejo#411). */
  | "privateTarget"
  /** Not a well-formed http(s) URL. */
  | "invalidUrl"
  /** No answer within the time cap. */
  | "timeout"
  /** Connection refused, DNS failure, TLS failure: the host never answered. */
  | "unreachable"
  /** The body grew past the byte cap. */
  | "tooLarge";

export class BoundedFetchError extends Error {
  constructor(readonly reason: BoundedFetchFailure) {
    super(`Outbound request failed: ${reason}`);
    this.name = "BoundedFetchError";
  }
}

export interface BoundedRequest {
  method?: "GET" | "POST" | "PROPFIND" | "REPORT";
  headers?: Record<string, string>;
  body?: string;
  policy: TargetPolicy;
  /** Whole request: connect, headers and body. */
  timeoutMs: number;
  /** Bytes of body read, decompressed. */
  maxBytes: number;
  /** `https:` only (a plugin of an ordinary account); default allows `http:` too. */
  httpsOnly?: boolean;
}

export interface BoundedResponse {
  status: number;
  headers: Headers;
  body: Buffer;
}

/** Test seam: the fetch the request goes through. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function checkUrl(url: string, request: BoundedRequest): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BoundedFetchError("invalidUrl");
  }
  const allowed = request.httpsOnly ? ["https:"] : ["https:", "http:"];
  if (!allowed.includes(parsed.protocol) || parsed.username || parsed.password)
    throw new BoundedFetchError("invalidUrl");
  try {
    assertTargetAllowed(url, request.policy);
  } catch (error) {
    if (error instanceof PrivateTargetError) throw new BoundedFetchError("privateTarget");
    throw error;
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new BoundedFetchError("tooLarge");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BoundedFetchError("tooLarge");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export async function boundedFetch(
  url: string,
  request: BoundedRequest,
  fetchImpl: FetchLike = fetch as FetchLike
): Promise<BoundedResponse> {
  checkUrl(url, request);
  const dispatcher = fetchDispatcherFor(request.policy);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: request.method ?? "GET",
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
        // Never follow: a 3xx towards an internal host would walk past both checks.
        redirect: "manual",
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit);
    } catch (error) {
      if (isPrivateTargetRefusal(error)) throw new BoundedFetchError("privateTarget");
      if (controller.signal.aborted) throw new BoundedFetchError("timeout");
      throw new BoundedFetchError("unreachable");
    }
    try {
      const body = await readCapped(response, request.maxBytes);
      return { status: response.status, headers: response.headers, body };
    } catch (error) {
      if (error instanceof BoundedFetchError) throw error;
      if (controller.signal.aborted) throw new BoundedFetchError("timeout");
      throw new BoundedFetchError("unreachable");
    }
  } finally {
    clearTimeout(timer);
  }
}
