/**
 * Rate-limited warnings for slow work (perf audit 2026-11, item 4). Prod had
 * no latency record at all: HTTP logging sits behind a runtime flag that is
 * off, and query durations were logged at debug only. A request over 1 s and
 * a query over 500 ms are now always logged at warn, but at most once per key
 * and window, so a slow endpoint hammered by a poll cannot flood the log; the
 * next line carries how many were suppressed meanwhile.
 *
 * The most recent entries stay in memory for the admin runtime card.
 */

import { dbLogger, httpLogger } from "../../utils/logger";

export const SLOW_REQUEST_MS = 1_000;
export const SLOW_QUERY_MS = 500;
/** One line per key and window. */
export const SLOW_LOG_WINDOW_MS = 60_000;
/** Distinct keys remembered; beyond it the oldest is forgotten. */
const MAX_KEYS = 500;
/** Entries kept for the runtime card. */
const RECENT_KEPT = 20;

export interface SlowEntry {
  key: string;
  durationMs: number;
  recordedAt: string;
  /** Slow occurrences of this key not logged since its previous line. */
  suppressed: number;
}

export type SlowSink = (entry: SlowEntry, context: Record<string, unknown>) => void;

export interface SlowLog {
  note(key: string, durationMs: number, context?: Record<string, unknown>): void;
  recent(): SlowEntry[];
}

export function createSlowLog(opts: {
  thresholdMs: number;
  windowMs?: number;
  sink: SlowSink;
  now?: () => number;
}): SlowLog {
  const windowMs = opts.windowMs ?? SLOW_LOG_WINDOW_MS;
  const now = opts.now ?? (() => Date.now());
  const keys = new Map<string, { lastLoggedAt: number; suppressed: number }>();
  const recent: SlowEntry[] = [];

  return {
    note(key, durationMs, context = {}) {
      if (!(durationMs >= opts.thresholdMs)) return;
      const t = now();
      const seen = keys.get(key);
      if (seen && t - seen.lastLoggedAt < windowMs) {
        seen.suppressed += 1;
        return;
      }
      const entry: SlowEntry = {
        key,
        durationMs: Math.round(durationMs),
        recordedAt: new Date(t).toISOString(),
        suppressed: seen?.suppressed ?? 0,
      };
      keys.delete(key);
      keys.set(key, { lastLoggedAt: t, suppressed: 0 });
      if (keys.size > MAX_KEYS) keys.delete(keys.keys().next().value as string);
      recent.unshift(entry);
      if (recent.length > RECENT_KEPT) recent.length = RECENT_KEPT;
      opts.sink(entry, context);
    },
    recent: () => recent.map((e) => ({ ...e })),
  };
}

/** Requests over 1 s, keyed by method and route pattern (never the query string). */
export const slowRequests = createSlowLog({
  thresholdMs: SLOW_REQUEST_MS,
  sink: (entry, context) =>
    httpLogger.warn({
      operation: "slow_request",
      message: `Slow request: ${entry.key} took ${entry.durationMs} ms`,
      context: { ...context, route: entry.key, suppressedSinceLast: entry.suppressed },
      performance: { duration: entry.durationMs },
    }),
});

/** Prisma operations over 500 ms, keyed by model and operation (raw queries: `$queryRaw` etc.). */
export const slowQueries = createSlowLog({
  thresholdMs: SLOW_QUERY_MS,
  sink: (entry, context) =>
    dbLogger.warn({
      operation: "slow_query",
      message: `Slow query: ${entry.key} took ${entry.durationMs} ms`,
      context: { ...context, query: entry.key, suppressedSinceLast: entry.suppressed },
      performance: { duration: entry.durationMs },
    }),
});
