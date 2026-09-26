import NodeCache from "node-cache";
import type { z } from "zod";

import logger from "../../../utils/logger";
import type { RailDeadline } from "./types";

/**
 * Shared plumbing for the train-number lookup (Transitous, db-rest).
 *
 * Both are free services run by volunteers for open-source, non-commercial
 * use. Transitous asks every client for a User-Agent with contact details and
 * for caching; db-rest allows ~100 requests a minute. So every answer is
 * cached by its URL, every call gives up quickly, and a failure is a result
 * ("unavailable"), never an exception that takes the request down.
 */

export const RAIL_LOOKUP_TIMEOUT_MS = 8_000;

/**
 * One lookup, all providers and all requests together. Transitous may need up
 * to six stoptimes windows plus the trip and db-rest up to three calls, each
 * allowed 8 s — about a minute in the worst case, far past the client's
 * 10 s default. The budget stops that early and says which provider it cut
 * short; the frontend waits a little longer than this for this one call
 * (`RAIL_LOOKUP_CLIENT_TIMEOUT_MS`), so the answer arrives before it gives up.
 */
export const RAIL_LOOKUP_BUDGET_MS = 20_000;

/** Below this, a request is not worth starting — it could not finish. */
const MIN_REQUEST_MS = 500;

export function lookupDeadline(budgetMs = RAIL_LOOKUP_BUDGET_MS): RailDeadline {
  return { at: Date.now() + budgetMs };
}

export function remainingMs(deadline: RailDeadline): number {
  return deadline.at - Date.now();
}

/** Whether the budget still has room for one request. */
export function hasTimeLeft(deadline: RailDeadline): boolean {
  return remainingMs(deadline) >= MIN_REQUEST_MS;
}

/** Timetable answers change rarely within a day; a trip's shape never does. */
export const RAIL_CACHE_TTL_S = 6 * 60 * 60;

/**
 * Entries are the VALIDATED answers, which Zod has already stripped to the
 * fields we read — a four-hour stoptimes page at Frankfurt Hbf is ~270 kB on
 * the wire and a few kB here. The cap bounds memory whatever the traffic.
 */
const MAX_ENTRIES = 1_000;

const PROJECT_URL = "https://github.com/Abrechen2/TravStats";

/**
 * `TravStats (…; +project; contact)`. The contact is the instance operator's
 * (`RAIL_LOOKUP_CONTACT`, an e-mail or URL) — Transitous' terms ask for a way
 * to reach whoever runs the client. Without it the project URL stands in,
 * which reaches the maintainer rather than the operator; the env var is
 * documented so an operator can do better.
 */
export function railUserAgent(): string {
  const contact = process.env.RAIL_LOOKUP_CONTACT?.trim();
  const reach = contact && contact.length <= 200 ? `; ${contact}` : "";
  return `TravStats (self-hosted travel logbook; +${PROJECT_URL}${reach})`;
}

const cache = new NodeCache({ stdTTL: RAIL_CACHE_TTL_S, useClones: false });

/** For tests: forget every cached answer. */
export function __clearRailHttpCache(): void {
  cache.flushAll();
}

/**
 * `outOfTime` = the lookup's budget ran out (before or during the request);
 * `failed` = the service itself did not deliver.
 */
export type RailFetchResult<T> =
  { ok: true; data: T } | { ok: false; reason: "failed" | "outOfTime" };

/**
 * GET JSON, validate it, cache the validated value by URL. `ok: false` on a
 * network error, timeout, non-2xx, or a body that is not JSON or not the
 * shape we expect — each logged with the service name, so a quiet
 * "unavailable" can still be traced. Failures are not cached: the next press
 * of the button asks again.
 */
export async function fetchRailJson<T>(
  service: string,
  url: string,
  schema: z.ZodType<T>,
  deadline: RailDeadline | null = null
): Promise<RailFetchResult<T>> {
  const hit = cache.get<T>(url);
  if (hit !== undefined) return { ok: true, data: hit };
  if (deadline && !hasTimeLeft(deadline)) return { ok: false, reason: "outOfTime" };
  const timeout = deadline
    ? Math.min(RAIL_LOOKUP_TIMEOUT_MS, remainingMs(deadline))
    : RAIL_LOOKUP_TIMEOUT_MS;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": railUserAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      logger.warn({ operation: "rail_lookup_request", service, status: response.status });
      return { ok: false, reason: "failed" };
    }
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      logger.warn({
        operation: "rail_lookup_request",
        service,
        reason: "unexpected_shape",
        issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      return { ok: false, reason: "failed" };
    }
    if (cache.keys().length < MAX_ENTRIES) cache.set(url, parsed.data);
    return { ok: true, data: parsed.data };
  } catch (error) {
    logger.warn({
      operation: "rail_lookup_request",
      service,
      error: error instanceof Error ? error.message : String(error),
    });
    // A timeout cut short by the budget is the budget's doing, not the service's.
    const outOfTime = deadline !== null && !hasTimeLeft(deadline);
    return { ok: false, reason: outOfTime ? "outOfTime" : "failed" };
  }
}
