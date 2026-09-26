/**
 * The opt-in log categories that hot paths ask about on every request or
 * query, as plain booleans.
 *
 * Written only by `applyLoggingConfig()` (services/loggingConfig.ts) — at boot
 * and whenever an admin saves the logging settings — and read synchronously by
 * the request logger and the Prisma extension. Before this, the request logger
 * kept its own five-minute cache that no save ever invalidated, and the query
 * log polled the database every 30 s on a copy of its own: three answers to
 * one question.
 *
 * No imports, on purpose: `db.ts` reads it, and anything this module imported
 * would join the `db` ↔ `loggingConfig` cycle.
 */

export interface LoggingRuntimeFlags {
  httpRequests: boolean;
  databaseQueries: boolean;
}

let flags: LoggingRuntimeFlags = {
  httpRequests: false,
  databaseQueries: false,
};

export function setLoggingRuntimeFlags(next: LoggingRuntimeFlags): void {
  flags = { ...next };
}

export function getLoggingRuntimeFlags(): LoggingRuntimeFlags {
  return flags;
}
