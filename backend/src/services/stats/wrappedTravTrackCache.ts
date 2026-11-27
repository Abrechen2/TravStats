import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import logger from "../../utils/logger";

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

/** The account-wide inputs every figure depends on; `points` adds the newest point's number. */
function accountInputs(userId: string, points: boolean): Prisma.Sql {
  return Prisma.sql`
      (SELECT location_provider || ':' || location_provider_rev FROM user_settings WHERE user_id = ${userId}),
      (SELECT enabled::text FROM travtrack_config WHERE id = 'default'),
      (SELECT history_generation::text FROM travtrack_derivation_state WHERE user_id = ${userId}),
      ${points ? Prisma.sql`(SELECT max(seq)::text FROM travtrack_points WHERE user_id = ${userId})` : Prisma.sql`''`},
      (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') FROM travtrack_gaps WHERE user_id = ${userId}),
      (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') FROM travtrack_deleted_ranges WHERE user_id = ${userId}),
      (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') FROM travtrack_deleted_points WHERE user_id = ${userId}),
      (SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM travtrack_privacy_zones WHERE user_id = ${userId}),
      (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') FROM travtrack_zone_tombstones WHERE user_id = ${userId}),
      (SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM flights WHERE user_id = ${userId})`;
}

/** Everything the TravTrack figures of an account are computed from, as one string. */
export async function travTrackFingerprint(userId: string, zone: string): Promise<string> {
  const rows = await prisma.$queryRaw<FingerprintRow[]>`
    SELECT concat_ws('|', ${accountInputs(userId, true)}) AS fp`;
  return `${zone}|${rows[0]?.fp ?? ""}`;
}

const DAY_MS = 86_400_000;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The inputs of ONE year's figures (perf audit 2026-11, item 9). `max(seq)`
 * moved with every Companion upload and invalidated every year; instead the
 * year's own UTC days are read from `travtrack_dirty_days`, whose `version`
 * rises whenever a point of that day is stored or removed. One day either side
 * of the window covers the edge context a projection reads. One small index
 * read; the account-wide inputs stay as they were.
 */
export async function travTrackYearFingerprint(
  userId: string,
  zone: string,
  window: { fromMs: number; untilMs: number }
): Promise<string> {
  const fromDay = utcDay(window.fromMs - DAY_MS);
  const untilDay = utcDay(window.untilMs + DAY_MS);
  const rows = await prisma.$queryRaw<FingerprintRow[]>`
    SELECT concat_ws('|', ${accountInputs(userId, false)},
      (SELECT count(*) || ':' || coalesce(sum(version), 0)::text FROM travtrack_dirty_days
        WHERE user_id = ${userId} AND day BETWEEN ${fromDay}::date AND ${untilDay}::date)
    ) AS fp`;
  return `${zone}|${window.fromMs}|${rows[0]?.fp ?? ""}`;
}

/**
 * One year's figures from `travtrack_year_summaries` when its fingerprint
 * still matches, else computed and stored. Survives a deploy, unlike the
 * in-memory map below. A failed store is logged and the computed value served:
 * the row is a cache, the next request tries again.
 */
export async function persistedYearFigures<T>(
  userId: string,
  year: number,
  fingerprint: string,
  compute: () => Promise<T>
): Promise<T> {
  const row = await prisma.travTrackYearSummary.findUnique({
    where: { userId_year: { userId, year } },
    select: { fingerprint: true, value: true },
  });
  if (row && row.fingerprint === fingerprint) return (row.value as { v: T }).v;
  const value = await cachedTravTrackPart(userId, `year:${year}`, fingerprint, compute);
  const stored = { v: value } as unknown as Prisma.InputJsonValue;
  try {
    await prisma.travTrackYearSummary.upsert({
      where: { userId_year: { userId, year } },
      create: { userId, year, fingerprint, value: stored },
      update: { fingerprint, value: stored, computedAt: new Date() },
    });
  } catch (error) {
    logger.warn({
      operation: "travtrack_year_summary_store_failed",
      message: "The year's TravTrack figures could not be stored; they are recomputed next time",
      context: { userId, year },
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return value;
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
