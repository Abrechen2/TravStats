import { redact } from "./redact";

/** The fixed vocabulary of failures (plan section 5, rule 6). */
export type FailureReason =
  | "unreachable"
  | "auth"
  | "scope"
  | "not_found"
  | "rate_limited"
  | "disabled"
  | "timeout"
  | "server"
  | "invalid_input"
  | "config";

export class ToolFailure extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
    readonly details: { status?: number; code?: string; retryAfterSec?: number } = {}
  ) {
    super(message);
    this.name = "ToolFailure";
  }
}

const HINTS: Record<FailureReason, string> = {
  unreachable: "The TravStats server could not be reached. Check TRAVSTATS_URL and the network.",
  auth: "The server rejected the token (missing, wrong, expired or revoked). Create a new one in Settings.",
  scope: "The token's scope does not allow this call.",
  not_found: "The server has no such record, or it is not yours.",
  rate_limited: "The server's rate limit was hit. Wait before calling again.",
  disabled: "The server has this feature switched off.",
  timeout: "The server did not answer in time.",
  server: "The server failed on this request.",
  invalid_input: "The input is not valid for this tool.",
  config: "The package is not configured correctly.",
};

export function reasonForStatus(status: number, code?: string): FailureReason {
  if (status === 401) return "auth";
  if (status === 403) return code && /DISABLED/i.test(code) ? "disabled" : "scope";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status === 501 || status === 503)
    return code && /DISABLED|OFF/i.test(code) ? "disabled" : "server";
  return "server";
}

/** One line a model (and a person) can act on. The server's own text is quoted, redacted and cut. */
export function describeFailure(err: ToolFailure, token?: string): string {
  const extra = [
    err.details.status ? `HTTP ${err.details.status}` : null,
    err.details.code ?? null,
    err.details.retryAfterSec ? `retry after ${err.details.retryAfterSec}s` : null,
  ].filter(Boolean);
  const detail =
    err.message && err.message !== HINTS[err.reason]
      ? ` Server said: ${err.message.slice(0, 300)}`
      : "";
  return redact(
    `[${err.reason}] ${HINTS[err.reason]}${extra.length ? ` (${extra.join(", ")})` : ""}${detail}`,
    token
  );
}
