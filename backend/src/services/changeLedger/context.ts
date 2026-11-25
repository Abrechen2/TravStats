import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

import { isPropagating } from "../sharing/propagationGuard";

/**
 * Who and what made a change, for the change ledger
 * (`docs/superpowers/specs/2026-11-22-change-history.md`).
 *
 * The capture point is the query hook in `db.ts`, which knows the row and the
 * values but not the caller. So the caller's side rides the async context:
 * every request runs inside a store that holds the request itself (read
 * lazily — `authenticate` sets `userId` after this middleware ran), and the
 * paths that are not "a person pressed save" name themselves with
 * `withChangeSource` (an import, the flight auto-update, a merge). A write the
 * share propagation makes into another account is `share_sync` whatever else
 * is set, because that is what it is from the receiving account's view.
 */
export const CHANGE_SOURCES = [
  "web",
  "companion",
  "api",
  "import",
  "auto_update",
  "merge",
  "share_sync",
  "system",
] as const;
export type ChangeSource = (typeof CHANGE_SOURCES)[number];

/** The part of an Express request the ledger reads. */
interface RequestLike {
  userId?: string;
  apiToken?: { deviceId?: string | null; label?: string | null } | null;
  headers?: Record<string, string | string[] | undefined>;
}

/** The header `travstats-mcp` sends on every call (`travstats-mcp/<version>`). */
export const MCP_CLIENT_HEADER = "x-travstats-client";

/**
 * "via MCP / <token label>" for a write the MCP package made with a personal access token, so
 * the history says which assistant's token wrote it. Only a token-authenticated request counts: a
 * cookie session that sends the header is not an MCP call, and the label is the owner's own word.
 */
function mcpReason(request: RequestLike | undefined): string | null {
  if (!request?.apiToken || request.apiToken.deviceId) return null;
  const header = request.headers?.[MCP_CLIENT_HEADER];
  const client = Array.isArray(header) ? header[0] : header;
  if (typeof client !== "string" || !client.startsWith("travstats-mcp/")) return null;
  const label = request.apiToken.label?.trim();
  return `via MCP / ${label || "unnamed token"}`.slice(0, 200);
}

interface ChangeStore {
  request?: RequestLike;
  source?: ChangeSource;
  actorUserId?: string | null;
  reason?: string | null;
  restoredFromId?: string | null;
  suppressed?: boolean;
}

const store = new AsyncLocalStorage<ChangeStore>();

/** Mounted once, above the routers: every request's writes know their request. */
export function changeContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  store.run({ request: req as unknown as RequestLike }, next);
}

/**
 * Middleware: every write of the rest of this request is `source` (the import
 * and parser routes). Changes the request's own store, which no other request
 * shares.
 */
export function markChangeSource(source: ChangeSource) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    const current = store.getStore();
    if (current) current.source = source;
    next();
  };
}

export interface ChangeSourceOptions {
  reason?: string | null;
  actorUserId?: string | null;
  restoredFromId?: string | null;
}

/** Run `fn` with every tracked write inside it attributed to `source`. */
export function withChangeSource<T>(
  source: ChangeSource,
  fn: () => Promise<T>,
  options: ChangeSourceOptions = {}
): Promise<T> {
  const parent = store.getStore() ?? {};
  // Awaited INSIDE the scope: a Prisma query is a lazy thenable that runs only
  // when awaited, so handing it back unawaited would run it outside (see db.ts).
  return store.run({ ...parent, source, ...options }, async () => await fn());
}

/**
 * Run `fn` without recording: a one-off maintenance backfill that rewrites a
 * derived column on every row is not a correction anybody made, and would
 * otherwise bury each entry's real history under one machine row per field.
 */
export function withoutChangeLedger<T>(fn: () => Promise<T>): Promise<T> {
  const parent = store.getStore() ?? {};
  return store.run({ ...parent, suppressed: true }, async () => await fn());
}

export interface ResolvedChangeContext {
  source: ChangeSource;
  actorUserId: string | null;
  reason: string | null;
  restoredFromId: string | null;
}

function sourceOfRequest(request: RequestLike | undefined): ChangeSource {
  if (!request) return "system";
  if (request.apiToken?.deviceId) return "companion";
  if (request.apiToken) return "api";
  return "web";
}

/** The context of the write about to happen; null when recording is switched off here. */
export function resolveChangeContext(): ResolvedChangeContext | null {
  const current = store.getStore() ?? {};
  if (current.suppressed) return null;
  const source: ChangeSource = isPropagating()
    ? "share_sync"
    : (current.source ?? sourceOfRequest(current.request));
  return {
    source,
    actorUserId: current.actorUserId ?? current.request?.userId ?? null,
    reason: current.reason ?? mcpReason(current.request),
    restoredFromId: current.restoredFromId ?? null,
  };
}
