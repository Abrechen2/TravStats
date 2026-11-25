/**
 * One signed call to a suggestion plugin (spec 2026-11-23-plugins-and-
 * calendar.md, Part B), and what came back — an answer, "nothing here", or one
 * of a fixed set of failure reasons, never a thrown string:
 *
 *   timeout | unreachable | auth (401/403) | rateLimited (429, Retry-After) |
 *   protocol (bad JSON or schema, unknown major, a redirect) | server (5xx) |
 *   privateTarget (forgejo#411)
 *
 * The answer is untrusted input: Zod-validated, capped (64 KB, 5 suggestions,
 * string lengths), `url` https-only and never fetched. The forgejo#411 rule
 * holds on every call with DNS pinned; an ordinary account's plugin is https
 * only, an admin's own may be a plain-http container beside TravStats.
 */
import crypto from "crypto";
import { boundedFetch, BoundedFetchError, type FetchLike } from "../egress/boundedFetch";
import { plainHttpAllowed, type TargetPolicy } from "../egress/privateTargets";
import { sign } from "./signing";
import {
  PLUGIN_CONTRACT_VERSION,
  pluginHelloSchema,
  pluginResponseSchema,
  type PluginHello,
  type PluginRequest,
  type PluginSuggestion,
} from "./contract";

export const PLUGIN_TIMEOUT_MS = 5_000;
export const PLUGIN_CONNECT_TIMEOUT_MS = 2_000;
export const PLUGIN_MAX_BYTES = 64 * 1024;

export const PLUGIN_FAILURES = [
  "timeout",
  "unreachable",
  "auth",
  "rateLimited",
  "protocol",
  "server",
  "privateTarget",
] as const;
export type PluginFailure = (typeof PLUGIN_FAILURES)[number];

export type PluginOutcome =
  | { kind: "ok"; version: number; suggestions: PluginSuggestion[]; latencyMs: number }
  | { kind: "empty"; version: number | null; latencyMs: number }
  | {
      kind: "failed";
      reason: PluginFailure;
      /** 429 only: when the plugin may be asked again (Retry-After), epoch ms. */
      retryAtMs?: number;
      latencyMs: number;
    };

export interface PluginTarget {
  url: string;
  secret: string;
  policy: TargetPolicy;
}

const failed = (reason: PluginFailure, started: number, retryAtMs?: number): PluginOutcome => ({
  kind: "failed",
  reason,
  latencyMs: Date.now() - started,
  ...(retryAtMs !== undefined ? { retryAtMs } : {}),
});

/** Retry-After as seconds or an HTTP date; null when absent or unreadable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(now, at) : null;
}

export function headersFor(
  target: PluginTarget,
  method: "GET" | "POST",
  body: string,
  requestId: string = crypto.randomUUID()
) {
  const url = new URL(target.url);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(target.secret, {
    method,
    path: `${url.pathname}${url.search}`,
    timestamp,
    requestId,
    body,
  });
  return {
    requestId,
    headers: {
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      Accept: "application/json",
      "TravStats-Plugin-Version": String(PLUGIN_CONTRACT_VERSION),
      "TravStats-Timestamp": String(timestamp),
      "TravStats-Signature": signature,
      "TravStats-Request-Id": requestId,
    },
  };
}

export async function send(
  target: PluginTarget,
  method: "GET" | "POST",
  body: string,
  headers: Record<string, string>,
  fetchImpl?: FetchLike,
  limits: { timeoutMs?: number; maxBytes?: number } = {}
) {
  return boundedFetch(
    target.url,
    {
      method,
      headers,
      body: method === "POST" ? body : undefined,
      policy: target.policy,
      timeoutMs: limits.timeoutMs ?? PLUGIN_TIMEOUT_MS,
      connectTimeoutMs: PLUGIN_CONNECT_TIMEOUT_MS,
      maxBytes: limits.maxBytes ?? PLUGIN_MAX_BYTES,
      httpsOnly: !plainHttpAllowed(target.url, target.policy),
    },
    fetchImpl
  );
}

export function fetchFailure(error: unknown, started: number): PluginOutcome {
  if (!(error instanceof BoundedFetchError)) throw error;
  switch (error.reason) {
    case "privateTarget":
      return failed("privateTarget", started);
    case "timeout":
      return failed("timeout", started);
    case "tooLarge":
    case "invalidUrl":
      return failed("protocol", started);
    default:
      return failed("unreachable", started);
  }
}

function statusFailure(
  status: number,
  retryAfter: string | null,
  started: number
): PluginOutcome | null {
  if (status === 401 || status === 403) return failed("auth", started);
  if (status === 429) return failed("rateLimited", started, retryAfterMs(retryAfter) ?? undefined);
  if (status >= 500) return failed("server", started);
  if (status !== 200 && status !== 204) return failed("protocol", started);
  return null;
}

/** Asks the plugin about one stop (or the test stop). Builds, signs, sends, validates. */
export async function callPlugin(
  target: PluginTarget,
  request: Omit<PluginRequest, "requestId" | "version">,
  fetchImpl?: FetchLike
): Promise<PluginOutcome> {
  const started = Date.now();
  // The request id is part of the signed string AND of the body: built first, then both.
  const requestId = crypto.randomUUID();
  const payload: PluginRequest = { version: PLUGIN_CONTRACT_VERSION, requestId, ...request };
  const body = JSON.stringify(payload);
  const { headers } = headersFor(target, "POST", body, requestId);
  let res;
  try {
    res = await send(target, "POST", body, headers, fetchImpl);
  } catch (error) {
    return fetchFailure(error, started);
  }
  const bad = statusFailure(res.status, res.headers.get("retry-after"), started);
  if (bad) return bad;
  const latencyMs = Date.now() - started;
  if (res.status === 204 || res.body.length === 0)
    return { kind: "empty", version: null, latencyMs };
  let json: unknown;
  try {
    json = JSON.parse(res.body.toString("utf8"));
  } catch {
    return failed("protocol", started);
  }
  const parsed = pluginResponseSchema.safeParse(json);
  if (!parsed.success || parsed.data.version !== PLUGIN_CONTRACT_VERSION)
    return failed("protocol", started);
  if (parsed.data.suggestions.length === 0)
    return { kind: "empty", version: parsed.data.version, latencyMs };
  return {
    kind: "ok",
    version: parsed.data.version,
    suggestions: parsed.data.suggestions,
    latencyMs,
  };
}

/** The optional signed hello (`GET <url>`): null when the plugin does not offer one. */
export async function helloPlugin(
  target: PluginTarget,
  fetchImpl?: FetchLike
): Promise<PluginHello | null> {
  const { headers } = headersFor(target, "GET", "");
  try {
    const res = await send(target, "GET", "", headers, fetchImpl);
    if (res.status !== 200) return null;
    const parsed = pluginHelloSchema.safeParse(JSON.parse(res.body.toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
