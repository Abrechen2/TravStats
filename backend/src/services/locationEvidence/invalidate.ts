/**
 * History deleted — open questions vanish, answers stay (TravTrack plan E5;
 * review focus 23). The `onPointsRemoved` handler for everything TravStats
 * derived from TravTrack history and asked the user about: stay, market and
 * venue findings (`dawarich_stays`, provider `travtrack`) and the questions of
 * `location_suggestions` (country; journey once E7 writes them). It runs in
 * the removal's transaction, under the TravTrack lock, after the points went
 * and after the history generation was raised (`deleteRange.ts`).
 *
 * A row is AFFECTED when any of:
 *   - its window overlaps one of the removed spans (range, zone, origin);
 *   - one of its point digests is a removed point's (a constituent point went,
 *     wherever its window lies);
 *   - zone: its source position lies in the circle — even when the zone
 *     deleted no point (a journey's line and ends: E7 adds them here);
 *   - no pin (a country question): one of its days is a removed day.
 *
 * Affected OPEN rows (every status but `accepted`) are DELETED: they hold
 * positions and digests of the deleted history, and none is an entry the user
 * made. A venue that goes hands the fragments it replaced and that are not
 * affected themselves back to the inbox, as rejecting it would.
 * Affected ACCEPTED rows stay — the entry the answer made is TravStats data —
 * with their evidence cut to a summary holding no position and no digest
 * (`source`, `provider`, `algorithmVersion`, the explanation, the time zone or
 * the country, `historyDeletedAt`); a stay's source position becomes its
 * accepted pin. Dawarich rows are never touched: their history is not ours.
 *
 * Logged with ids and counts only (`EvidenceInvalidated`).
 */
import type { DbTransaction } from "../../db";
import logger from "../../utils/logger";
import { distanceM } from "../travtrack/classify";
import type { PointsRemovedCause } from "../travtrack/deleteRange";
import { pointDigest } from "./key";

const DAY_MS = 86_400_000;
/** How many affected ids one log line names; the counts are always complete. */
const LOGGED_IDS = 50;

type Span = readonly [number, number];

/** Whether `[from, until]` meets one of the sorted, disjoint `spans` (both closed). */
export function overlapsAny(spans: readonly Span[], from: number, until: number): boolean {
  let lo = 0;
  let hi = spans.length;
  // The first span that does not end before `from`.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid][1] < from) lo = mid + 1;
    else hi = mid;
  }
  return lo < spans.length && spans[lo][0] <= until;
}

/** Whether one of `days` (`YYYY-MM-DD`, UTC) lies in `[from, until)`. */
const dayInWindow = (days: readonly string[], from: number, until: number) =>
  days.some((d) => {
    const ms = Date.parse(`${d}T00:00:00.000Z`);
    return ms + DAY_MS > from && ms < until;
  });

const sortedSpans = (cause: PointsRemovedCause): Span[] =>
  [...cause.spans].sort((a, b) => a[0] - b[0]);

async function affectedStays(
  tx: DbTransaction,
  userId: string,
  cause: PointsRemovedCause,
  digests: string[]
): Promise<{ open: string[]; accepted: string[] }> {
  const spans = sortedSpans(cause);
  const rows = await tx.dawarichStay.findMany({
    where: { userId, provider: "travtrack" },
    select: {
      id: true,
      status: true,
      sourceStartAt: true,
      sourceEndAt: true,
      sourceLat: true,
      sourceLon: true,
    },
  });
  const hit = new Set<string>();
  for (const r of rows) {
    if (overlapsAny(spans, r.sourceStartAt.getTime(), r.sourceEndAt.getTime())) hit.add(r.id);
    else if (
      cause.kind === "zone" &&
      distanceM({ lat: r.sourceLat, lon: r.sourceLon }, cause.zone) <= cause.zone.radiusM
    )
      hit.add(r.id);
  }
  if (digests.length > 0) {
    const byDigest = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM dawarich_stays
       WHERE user_id = ${userId} AND provider = 'travtrack'
         AND jsonb_exists_any(evidence->'pointDigests', ${digests}::text[])`;
    for (const r of byDigest) hit.add(r.id);
  }
  const status = new Map(rows.map((r) => [r.id, r.status]));
  const ids = [...hit];
  return {
    open: ids.filter((id) => status.get(id) !== "accepted"),
    accepted: ids.filter((id) => status.get(id) === "accepted"),
  };
}

async function affectedSuggestions(
  tx: DbTransaction,
  userId: string,
  cause: PointsRemovedCause,
  digests: string[]
): Promise<{ open: string[]; accepted: string[] }> {
  const spans = sortedSpans(cause);
  const rows = await tx.locationSuggestion.findMany({
    where: { userId, provider: "travtrack" },
    select: { id: true, kind: true, status: true, windowFrom: true, windowUntil: true },
  });
  const hit = new Set<string>();
  for (const r of rows) {
    const from = r.windowFrom.getTime();
    const until = r.windowUntil.getTime();
    // A country question has no pin: it is about its days.
    const affected =
      r.kind === "country"
        ? dayInWindow(cause.days, from, until)
        : overlapsAny(spans, from, until - 1);
    if (affected) hit.add(r.id);
  }
  if (digests.length > 0) {
    const byDigest = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM location_suggestions
       WHERE user_id = ${userId} AND provider = 'travtrack'
         AND (jsonb_exists_any(evidence->'pointDigests', ${digests}::text[])
              OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(evidence->'runs') = 'array' THEN evidence->'runs'
                       ELSE '[]'::jsonb END) AS run
                 WHERE jsonb_exists_any(run->'pointDigests', ${digests}::text[])))`;
    for (const r of byDigest) hit.add(r.id);
  }
  const status = new Map(rows.map((r) => [r.id, r.status]));
  const ids = [...hit];
  return {
    open: ids.filter((id) => status.get(id) !== "accepted"),
    accepted: ids.filter((id) => status.get(id) === "accepted"),
  };
}

/** Deletes open stay findings; a venue's unaffected fragments go back to pending. */
async function removeOpenStays(tx: DbTransaction, userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const venues = await tx.dawarichStay.findMany({
    where: { id: { in: ids } },
    select: { evidence: true },
  });
  const going = new Set(ids);
  const fragments = venues.flatMap((v) => {
    const replaced = (v.evidence as { supersededFindingIds?: unknown } | null)
      ?.supersededFindingIds;
    return Array.isArray(replaced)
      ? replaced.filter((f): f is string => typeof f === "string" && !going.has(f))
      : [];
  });
  const { count } = await tx.dawarichStay.deleteMany({ where: { userId, id: { in: ids } } });
  if (fragments.length > 0) {
    await tx.dawarichStay.updateMany({
      where: { userId, id: { in: fragments }, status: "superseded" },
      data: { status: "pending", resolvedAt: null },
    });
  }
  return count;
}

/** An accepted stay keeps its answer and a summary; its source position becomes its pin. */
async function stripAcceptedStays(tx: DbTransaction, ids: string[], at: string): Promise<void> {
  if (ids.length === 0) return;
  await tx.$executeRaw`
    UPDATE dawarich_stays
       SET source_lat = lat, source_lon = lon,
           evidence = jsonb_strip_nulls(jsonb_build_object(
             'source', evidence->'source',
             'provider', provider,
             'algorithmVersion', algorithm_version,
             'kind', evidence->'kind',
             'zone', evidence->'zone',
             'explanation', evidence->'explanation',
             'historyDeletedAt', COALESCE(evidence->'historyDeletedAt', to_jsonb(${at}::text))))
     WHERE id = ANY(${ids}::text[])`;
}

async function stripAcceptedSuggestions(
  tx: DbTransaction,
  ids: string[],
  at: string
): Promise<void> {
  if (ids.length === 0) return;
  await tx.$executeRaw`
    UPDATE location_suggestions
       SET evidence = jsonb_strip_nulls(jsonb_build_object(
             'source', 'travtrack',
             'provider', provider,
             'algorithmVersion', algorithm,
             'countryCode', evidence->'countryCode',
             'historyDeletedAt', COALESCE(evidence->'historyDeletedAt', to_jsonb(${at}::text))))
     WHERE id = ANY(${ids}::text[])`;
}

/** The `onPointsRemoved` handler (`deleteRange.ts`). */
export async function invalidateOnHistoryDeleted(
  tx: DbTransaction,
  userId: string,
  cause: PointsRemovedCause
): Promise<void> {
  const digests = cause.keys ? [...cause.keys].map((k) => pointDigest(userId, k)) : [];
  const stays = await affectedStays(tx, userId, cause, digests);
  const questions = await affectedSuggestions(tx, userId, cause, digests);
  const at = new Date().toISOString();
  const removedStays = await removeOpenStays(tx, userId, stays.open);
  if (questions.open.length > 0) {
    await tx.locationSuggestion.deleteMany({ where: { userId, id: { in: questions.open } } });
  }
  await stripAcceptedStays(tx, stays.accepted, at);
  await stripAcceptedSuggestions(tx, questions.accepted, at);
  const removed = [...stays.open, ...questions.open];
  const kept = [...stays.accepted, ...questions.accepted];
  if (removed.length + kept.length === 0) return;
  logger.info({
    operation: "EvidenceInvalidated",
    userId,
    reason: cause.kind === "zone" ? "zone" : "historyDeleted",
    removedStays,
    removedQuestions: questions.open.length,
    strippedAccepted: kept.length,
    ids: [...removed, ...kept].slice(0, LOGGED_IDS),
  });
}
