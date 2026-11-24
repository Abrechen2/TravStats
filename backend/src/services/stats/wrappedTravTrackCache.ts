import { prisma } from "../../db";

/**
 * The year in review's TravTrack figures, kept until their inputs change
 * (UAT rc.45, M1).
 *
 * `GET /stats/wrapped` took 14–36 s on a large account and the browser gave up
 * after 10 s. Profiled on a synthetic account (3000 flights, 600 000 points):
 * the logbook half took 74 ms, `travTrackYearStats` 3.2 s of the 3.6 s — it
 * reads every privacy-safe fix of the year page by page. The figures depend on
 * nothing but the account's TravTrack history, its privacy zones, its flights
 * (a fix inside a flight is not ground) and its profile zone, so they are kept
 * per account and recomputed only when the fingerprint below moves.
 *
 * The fingerprint is one round trip of index reads. Points are immutable and
 * numbered (`seq`), so a new point raises `max(seq)`; every removal raises the
 * history generation (`bumpHistoryGeneration`); gaps, deleted spans and
 * deleted points, privacy zones and their tombstones, and flights are counted
 * with their newest timestamp. A stale figure is never served: a changed input
 * means a recomputation, never yesterday's number.
 */

type FingerprintRow = { fp: string };

/** Everything the TravTrack figures of an account are computed from, as one string. */
export async function travTrackFingerprint(userId: string, zone: string): Promise<string> {
  const rows = await prisma.$queryRaw<FingerprintRow[]>`
    SELECT concat_ws('|',
      (SELECT location_provider || ':' || location_provider_rev FROM user_settings WHERE user_id = ${userId}),
      (SELECT enabled::text FROM travtrack_config WHERE id = 'default'),
      (SELECT history_generation::text FROM travtrack_derivation_state WHERE user_id = ${userId}),
      (SELECT max(seq)::text FROM travtrack_points WHERE user_id = ${userId}),
      (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') FROM travtrack_gaps WHERE user_id = ${userId}),
      (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') FROM travtrack_deleted_ranges WHERE user_id = ${userId}),
      (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') FROM travtrack_deleted_points WHERE user_id = ${userId}),
      (SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM travtrack_privacy_zones WHERE user_id = ${userId}),
      (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') FROM travtrack_zone_tombstones WHERE user_id = ${userId}),
      (SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM flights WHERE user_id = ${userId})
    ) AS fp`;
  return `${zone}|${rows[0]?.fp ?? ""}`;
}

/** Entries kept at most; the oldest goes first. A figure is small, the bound is defensive. */
const MAX_ENTRIES = 500;

const cache = new Map<string, { fingerprint: string; value: unknown }>();
const inFlight = new Map<string, { fingerprint: string; promise: Promise<unknown> }>();

/**
 * `compute()` for this account and `part`, unless the same fingerprint already
 * answered it (or is answering it right now — two requests share one run).
 */
export async function cachedTravTrackPart<T>(
  userId: string,
  part: string,
  fingerprint: string,
  compute: () => Promise<T>
): Promise<T> {
  const key = `${userId}\u0000${part}`;
  const hit = cache.get(key);
  if (hit && hit.fingerprint === fingerprint) return hit.value as T;
  const running = inFlight.get(key);
  if (running && running.fingerprint === fingerprint) return running.promise as Promise<T>;
  // A failure is not kept: the next request computes again.
  const promise = compute().then((value) => {
    cache.delete(key);
    cache.set(key, { fingerprint, value });
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    return value;
  });
  inFlight.set(key, { fingerprint, promise });
  try {
    return await promise;
  } finally {
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
  }
}

/** Test seam. */
export function clearWrappedTravTrackCache(): void {
  cache.clear();
  inFlight.clear();
}
