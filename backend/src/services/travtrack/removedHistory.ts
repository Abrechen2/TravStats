/**
 * What a removal of TravTrack history takes away, computed in the removal's
 * transaction BEFORE the points go (TravTrack plan E5): the handlers that run
 * after the delete (`onPointsRemoved`) can no longer read it.
 *
 *   - `spans`: the removed points' instants, merged where less than
 *     `SPAN_JOIN_MS` apart — what a finding's window is compared with;
 *   - `days`: their UTC days — what the projections re-derive and what a
 *     pinless question (a country) is compared with;
 *   - `keys`: their position keys (`positionKey`), from which the invalidation
 *     derives the account's point digests. Null when more than `KEY_CAP`
 *     points went: a finding's constituent points lie inside its own window,
 *     so the spans alone already find every finding that lost one, and the
 *     digests are a second net, not the only one.
 *
 * Aggregated in SQL, so a range of a year costs one pass, not a year of rows
 * in memory.
 */
import type { DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { positionKey } from "./classify";

/** Instants this close belong to one span. */
export const SPAN_JOIN_MS = 30 * 60_000;
/** The most removed points whose keys are listed. */
export const KEY_CAP = 50_000;

export type RemovedHistory = {
  spans: Array<[number, number]>;
  days: string[];
  keys: ReadonlySet<string> | null;
};

export const NOTHING_REMOVED: RemovedHistory = { spans: [], days: [], keys: new Set() };

/**
 * The history `where` (a condition on `travtrack_points` of this account) is
 * about to lose. One pass over the matching points (a materialised CTE):
 * count, days and spans used to be three separate scans plus a fourth for the
 * keys, and a zone's circle has no index, so each of them read the account's
 * whole history (perf audit 2026-11, item 6).
 */
export async function collectRemoved(
  tx: DbTransaction,
  userId: string,
  where: Prisma.Sql
): Promise<RemovedHistory> {
  const scope = Prisma.sql`user_id = ${userId} AND (${where})`;
  const [row] = await tx.$queryRaw<
    {
      n: bigint;
      days: string[] | null;
      spans: Array<{ f: string; u: string }> | null;
      keys: Array<[number, number, number]> | null;
    }[]
  >`
    WITH m AS MATERIALIZED (
      SELECT t, t_s, lat, lon FROM travtrack_points WHERE ${scope}
    ),
    marked AS (
      SELECT t,
             CASE WHEN lag(t) OVER (ORDER BY t) IS NULL
                    OR t - lag(t) OVER (ORDER BY t) >= ${SPAN_JOIN_MS} * interval '1 millisecond'
                  THEN 1 ELSE 0 END AS fresh
        FROM m
    ),
    grouped AS (SELECT t, sum(fresh) OVER (ORDER BY t) AS grp FROM marked)
    SELECT
      (SELECT count(*) FROM m) AS n,
      (SELECT array_agg(d ORDER BY d) FROM (SELECT DISTINCT to_char(t, 'YYYY-MM-DD') AS d FROM m) x) AS days,
      (SELECT json_agg(json_build_object('f', f, 'u', u) ORDER BY f) FROM (
         SELECT to_char(min(t), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS f,
                to_char(max(t), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS u
           FROM grouped GROUP BY grp) s) AS spans,
      (SELECT CASE WHEN count(*) <= ${KEY_CAP} THEN json_agg(json_build_array(t_s, lat, lon)) END
         FROM m) AS keys`;
  if (!row || row.n === 0n) return NOTHING_REMOVED;
  return {
    spans: (row.spans ?? []).map((s) => [Date.parse(s.f), Date.parse(s.u)]),
    days: row.days ?? [],
    keys: row.keys
      ? new Set(row.keys.map(([tS, lat, lon]) => positionKey({ tS, lat, lon })))
      : null,
  };
}
