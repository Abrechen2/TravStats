/**
 * The signed location-maintenance calls to a plugin (optional capability
 * `maintenance`, contract in `contract.ts`). Same signature, egress rule and
 * failure vocabulary as a stop call, plus the three answers only maintenance
 * has: `readOnly` (the plugin's data source refuses writes), `changed` (an undo
 * whose row was edited since) and `notFound` (no such row or applied change).
 * `unsupported`: the plugin has no such route.
 *
 * The answer is untrusted input and Zod-validated; the body cap is larger than
 * a stop answer's (a list of rows), still bounded.
 */
import crypto from "crypto";
import type { FetchLike } from "../egress/boundedFetch";
import { fetchFailure, headersFor, send, type PluginFailure, type PluginTarget } from "./client";
import {
  PLUGIN_CONTRACT_VERSION,
  maintenanceApplyResponseSchema,
  maintenanceConfirmResponseSchema,
  maintenanceIgnoreResponseSchema,
  maintenanceProposalsResponseSchema,
  maintenanceUndoResponseSchema,
} from "./contract";

export const MAINTENANCE_TIMEOUT_MS = 15_000;
export const MAINTENANCE_MAX_BYTES = 1024 * 1024;

export type MaintenanceFailure =
  | PluginFailure
  | "readOnly"
  | "changed"
  | "confirmationRequired"
  | "notFound"
  | "unsupported"
  | "notReady";

export type MaintenanceOutcome<T> =
  { kind: "ok"; data: T } | { kind: "failed"; reason: MaintenanceFailure };

export type MaintenanceAction = "proposals" | "confirm" | "apply" | "undo" | "ignore";

// Plain ZodType values: indexing the precise schema types by a generic action
// made the type checker run out of memory.
const RESPONSE: Record<MaintenanceAction, { safeParse(v: unknown): SafeParse }> = {
  proposals: maintenanceProposalsResponseSchema,
  confirm: maintenanceConfirmResponseSchema,
  apply: maintenanceApplyResponseSchema,
  undo: maintenanceUndoResponseSchema,
  ignore: maintenanceIgnoreResponseSchema,
};
type SafeParse = { success: true; data: { version: number } } | { success: false };

/** `<plugin url>/maintenance/<action>`: the plugin's URL read as a directory. */
export function maintenanceUrl(pluginUrl: string, action: MaintenanceAction): string {
  const u = new URL(pluginUrl);
  if (!u.pathname.endsWith("/")) u.pathname = `${u.pathname}/`;
  u.search = "";
  return new URL(`maintenance/${action}`, u).toString();
}

function errorOf(body: Buffer): string | null {
  try {
    const parsed = JSON.parse(body.toString("utf8")) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : null;
  } catch {
    return null;
  }
}

/** One signed maintenance call; `payload` without version/requestId. */
export async function callMaintenance(
  target: PluginTarget,
  action: MaintenanceAction,
  payload: Record<string, unknown>,
  fetchImpl?: FetchLike
): Promise<MaintenanceOutcome<{ version: number } & Record<string, unknown>>> {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  const body = JSON.stringify({ version: PLUGIN_CONTRACT_VERSION, requestId, ...payload });
  const at = { ...target, url: maintenanceUrl(target.url, action) };
  const { headers } = headersFor(at, "POST", body, requestId);
  let res;
  try {
    res = await send(at, "POST", body, headers, fetchImpl, {
      timeoutMs: MAINTENANCE_TIMEOUT_MS,
      maxBytes: MAINTENANCE_MAX_BYTES,
    });
  } catch (error) {
    const f = fetchFailure(error, started);
    return { kind: "failed", reason: f.kind === "failed" ? f.reason : "protocol" };
  }
  const error = errorOf(res.body);
  if (res.status === 403 && error === "confirmationRequired")
    return { kind: "failed", reason: "confirmationRequired" };
  if (res.status === 401 || res.status === 403) return { kind: "failed", reason: "auth" };
  if (res.status === 409 && (error === "readOnly" || error === "changed"))
    return { kind: "failed", reason: error };
  if (res.status === 404)
    return { kind: "failed", reason: error === "notFound" ? "notFound" : "unsupported" };
  if (res.status === 405) return { kind: "failed", reason: "unsupported" };
  if (res.status === 429) return { kind: "failed", reason: "rateLimited" };
  if (res.status === 503 && error === "notReady") return { kind: "failed", reason: "notReady" };
  if (res.status >= 500) return { kind: "failed", reason: "server" };
  if (res.status !== 200) return { kind: "failed", reason: "protocol" };
  let json: unknown;
  try {
    json = JSON.parse(res.body.toString("utf8"));
  } catch {
    return { kind: "failed", reason: "protocol" };
  }
  const parsed = RESPONSE[action].safeParse(json);
  if (!parsed.success || parsed.data.version !== PLUGIN_CONTRACT_VERSION)
    return { kind: "failed", reason: "protocol" };
  return { kind: "ok", data: parsed.data as { version: number } & Record<string, unknown> };
}
