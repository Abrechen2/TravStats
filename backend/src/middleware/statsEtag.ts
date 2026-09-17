import crypto from "crypto";
import type { NextFunction, Response } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../db";
import logger from "../utils/logger";
import { buildVersion } from "../utils/version";
import type { AuthRequest } from "./auth";

/**
 * Conditional GET for the statistics endpoints (forgejo#50).
 *
 * A stats page fans out to 5-10 endpoints, and the common case is a reload of
 * an account nothing has been written to. Each of those recomputed everything.
 * This answers 304 instead, WITHOUT running the handler, whenever the data the
 * statistics are derived from has not moved.
 *
 * What "has not moved" means is the fingerprint below, and the whole
 * correctness of this file rests on it covering every input:
 *
 *  - every per-user table the stats routes read: row COUNT (catches a delete)
 *    and max(updated_at) (catches an insert or an edit). `flights`,
 *    `cruise_stops` and `user_achievements` got the column for this;
 *  - the user's settings (base currency, home airport, timezone) and
 *    birthdate, and the instance settings;
 *  - the build and the process start, so a deploy or a catalogue re-seed on
 *    boot is a new fingerprint;
 *  - the current UTC HOUR. The airport catalogue can be edited without a
 *    restart, and some figures are relative to "now" (rolling windows,
 *    "upcoming"). The hour bounds how long either can be stale, and costs one
 *    recomputation an hour per endpoint — still nearly all of the saving.
 *
 * `private, no-cache`, NEVER `public`: `/api` is no-store by default because a
 * CDN once served one user's authenticated response to another session.
 * `private` keeps this out of every shared cache, and `no-cache` makes the
 * browser revalidate on every load, so there is no stale window on the
 * client — only the 304 short-cut on the server.
 */

const PROCESS_STARTED_AT = Date.now();

type FingerprintRow = { part: string; n: bigint; latest: Date | null };

function fingerprintQuery(userId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT 'flights' AS part, count(*) AS n, max(updated_at) AS latest FROM flights WHERE user_id = ${userId}
    UNION ALL SELECT 'cruises', count(*), max(updated_at) FROM cruises WHERE user_id = ${userId}
    UNION ALL SELECT 'cruise_stops', count(*), max(s.updated_at) FROM cruise_stops s JOIN cruises c ON c.id = s.cruise_id WHERE c.user_id = ${userId}
    UNION ALL SELECT 'cruise_legs', count(*), max(l.updated_at) FROM cruise_legs l JOIN cruises c ON c.id = l.cruise_id WHERE c.user_id = ${userId}
    UNION ALL SELECT 'trips', count(*), max(updated_at) FROM trips WHERE user_id = ${userId}
    UNION ALL SELECT 'lodgings', count(*), max(updated_at) FROM lodgings WHERE user_id = ${userId}
    UNION ALL SELECT 'lodging_stays', count(*), max(updated_at) FROM lodging_stays WHERE user_id = ${userId}
    UNION ALL SELECT 'lodging_memberships', count(*), max(updated_at) FROM lodging_memberships WHERE user_id = ${userId}
    UNION ALL SELECT 'places', count(*), max(updated_at) FROM places WHERE user_id = ${userId}
    UNION ALL SELECT 'place_visits', count(*), max(updated_at) FROM place_visits WHERE user_id = ${userId}
    UNION ALL SELECT 'country_days', count(*), max(updated_at) FROM country_days WHERE user_id = ${userId}
    UNION ALL SELECT 'user_achievements', count(*), max(updated_at) FROM user_achievements WHERE user_id = ${userId}
    UNION ALL SELECT 'user_settings', count(*), max(updated_at) FROM user_settings WHERE user_id = ${userId}
    UNION ALL SELECT 'admin_settings', count(*), max(updated_at) FROM admin_settings
    UNION ALL SELECT 'birthdate', count(birthdate), max(birthdate) FROM users WHERE id = ${userId}
  `;
}

/** The ETag for one user and one URL at one moment. Exported for tests. */
export async function computeStatsEtag(
  userId: string,
  url: string,
  now = new Date()
): Promise<string> {
  const rows = await prisma.$queryRaw<FingerprintRow[]>(fingerprintQuery(userId));
  const parts = rows
    .map((r) => `${r.part}:${r.n.toString()}:${r.latest ? r.latest.toISOString() : "-"}`)
    .sort()
    .join("|");
  const hour = now.toISOString().slice(0, 13);
  const hash = crypto
    .createHash("sha256")
    .update([userId, url, buildVersion, PROCESS_STARTED_AT, hour, parts].join("\n"))
    .digest("base64url")
    .slice(0, 32);
  return `W/"${hash}"`;
}

/** RFC 9110 weak comparison against an If-None-Match list. */
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  const bare = (tag: string): string => tag.trim().replace(/^W\//, "");
  return header.split(",").some((candidate) => bare(candidate) === bare(etag));
}

export async function statsEtag(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.method !== "GET" || !req.userId) {
    next();
    return;
  }
  let etag: string;
  try {
    etag = await computeStatsEtag(req.userId, req.originalUrl);
  } catch (error) {
    // A fingerprint that cannot be read means "no short-cut", never "not
    // modified": fall through to a full, uncached answer.
    logger.warn({ error, operation: "stats_etag_failed" }, "stats ETag fingerprint failed");
    next();
    return;
  }
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, no-cache");
  if (matchesIfNoneMatch(req.headers["if-none-match"], etag)) {
    res.status(304).end();
    return;
  }
  next();
}
