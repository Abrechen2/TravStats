/**
 * Cap the connection pool before anything constructs a Prisma client.
 *
 * Prisma sizes its pool as `cpus * 2 + 1`, which is 65 on a 32-core machine
 * against a Postgres that allows 100. One dev server already connected is
 * enough to exhaust it, and the suite then fails in three figures with timeouts
 * and `40P01` deadlocks that read like broken code rather than a starved pool.
 * That has cost this project several debugging sessions.
 *
 * This runs in `setupFiles` — before the test file, and therefore before
 * `src/db.ts` reads the URL. `globalSetup` would be too late: its environment
 * does not reach the workers.
 */

/** The URL a test run should use. An explicitly chosen limit is left alone. */
export function withConnectionLimit(url: string, limit = 5): string {
  if (/[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=${limit}`;
}

const url = process.env.DATABASE_URL;
if (url) {
  process.env.DATABASE_URL = withConnectionLimit(url);
}
