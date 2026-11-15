/**
 * The reachability producer behind the `admin.publicUrl` check (spec
 * 2026-11-14 §12): one probe of `<publicUrl>/health`, answered with a closed
 * set of outcomes so the UI can say what went wrong instead of "failed".
 *
 * The probe sends a one-time nonce and `/health` echoes it only when this
 * process holds it. A version match is not enough: prod and the RC mirror run
 * the same version, and a public name that points at the wrong one must read
 * as `NOT_THIS_INSTANCE`, not as healthy.
 *
 * `NO_PUBLIC_URL` and `OUTBOUND_DISABLED` store nothing, so the item stays
 * `unknown`; every other outcome is stored with the URL it was measured on.
 */
import { randomBytes } from "crypto";
import { prisma } from "../../db";
import { internetAllowed } from "../internetGate";
import { getEffectivePublicUrl } from "./effectivePublicUrl";

export const PUBLIC_URL_PROBE_TIMEOUT_MS = 10_000;
export const PROBE_QUERY_PARAM = "probe";
const NONCE_TTL_MS = 60_000;
const NONCE_MAX_HELD = 16;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;

export type PublicUrlCheckErrorCode =
  | "NO_PUBLIC_URL"
  | "OUTBOUND_DISABLED"
  | "TIMEOUT"
  | "DNS"
  | "TLS"
  | "CONNECTION"
  | "HTTP_STATUS"
  | "NOT_THIS_INSTANCE";

export interface PublicUrlCheckResult {
  ok: boolean;
  checkedAt: string;
  url: string | null;
  httpStatus: number | null;
  errorCode: PublicUrlCheckErrorCode | null;
}

/** Nonces this process has handed out and not yet seen come back (value: expiry). */
const held = new Map<string, number>();

function issueNonce(now: number): string {
  for (const [nonce, expires] of held) if (expires <= now) held.delete(nonce);
  // A flood of probes cannot grow the map without bound: the oldest one goes.
  while (held.size >= NONCE_MAX_HELD) held.delete(held.keys().next().value as string);
  const nonce = randomBytes(16).toString("hex");
  held.set(nonce, now + NONCE_TTL_MS);
  return nonce;
}

/**
 * `/health` asks this with the query value it received. True exactly once for a
 * nonce this process issued and that has not expired; the answer consumes it.
 */
export function redeemProbeNonce(candidate: unknown, now: number = Date.now()): boolean {
  if (typeof candidate !== "string" || !NONCE_PATTERN.test(candidate)) return false;
  const expires = held.get(candidate);
  if (expires === undefined) return false;
  held.delete(candidate);
  return expires > now;
}

/** Test seam. */
export function resetProbeNonces(): void {
  held.clear();
}

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA", "EAI_FAIL"]);
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"]);

function codeOf(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause?.code ?? (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

/** Map a thrown fetch failure to its outcome. */
export function classifyFetchError(error: unknown): PublicUrlCheckErrorCode {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return "TIMEOUT";
  const code = codeOf(error);
  if (TIMEOUT_CODES.has(code)) return "TIMEOUT";
  if (DNS_CODES.has(code)) return "DNS";
  if (
    code.startsWith("ERR_TLS_") ||
    code.startsWith("ERR_SSL_") ||
    code.startsWith("CERT_") ||
    code.includes("CERT") ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT"
  ) {
    return "TLS";
  }
  return "CONNECTION";
}

function healthUrlOf(publicUrl: string, nonce: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(publicUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const base = parsed.toString().replace(/\/+$/, "");
  return `${base}/health?${PROBE_QUERY_PARAM}=${nonce}`;
}

function outcome(
  now: Date,
  url: string | null,
  errorCode: PublicUrlCheckErrorCode | null,
  httpStatus: number | null = null
): PublicUrlCheckResult {
  return { ok: errorCode === null, checkedAt: now.toISOString(), url, httpStatus, errorCode };
}

/** The probe itself, with no settings lookup and nothing stored. */
export async function probePublicUrl(
  publicUrl: string,
  now: Date = new Date()
): Promise<PublicUrlCheckResult> {
  const nonce = issueNonce(now.getTime());
  const target = healthUrlOf(publicUrl, nonce);
  if (!target) {
    held.delete(nonce);
    return outcome(now, null, "NO_PUBLIC_URL");
  }
  let response: Response;
  let text: string;
  try {
    response = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(PUBLIC_URL_PROBE_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    text = await response.text();
  } catch (error) {
    held.delete(nonce);
    return outcome(now, publicUrl, classifyFetchError(error));
  }
  held.delete(nonce);
  const status = response.status;
  if (status < 200 || status >= 300) return outcome(now, publicUrl, "HTTP_STATUS", status);
  let body = null as { status?: unknown; probe?: unknown } | null;
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    body = null;
  }
  // Another server (or the right one behind a cache) answered: the nonce did not come back.
  if (!body || body.probe !== nonce) return outcome(now, publicUrl, "NOT_THIS_INSTANCE", status);
  // This instance, but not healthy: its own answer is the failure.
  if (body.status !== "ok") return outcome(now, publicUrl, "HTTP_STATUS", status);
  return outcome(now, publicUrl, null, status);
}

/**
 * Probe the instance's configured public URL and keep the verdict where the
 * evaluator reads it. Never called from a read path (spec §12).
 */
export async function runPublicUrlCheck(now: Date = new Date()): Promise<PublicUrlCheckResult> {
  const settings = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  const publicUrl = await getEffectivePublicUrl();
  if (!settings || !publicUrl) return outcome(now, null, "NO_PUBLIC_URL");
  if (!(await internetAllowed())) return outcome(now, publicUrl, "OUTBOUND_DISABLED");
  const result = await probePublicUrl(publicUrl, now);
  if (result.errorCode === "NO_PUBLIC_URL") return result;
  await prisma.adminSettings.update({
    where: { id: settings.id },
    data: {
      publicUrlCheckedAt: now,
      publicUrlCheckOk: result.ok,
      publicUrlCheckedUrl: publicUrl,
    },
  });
  return result;
}
