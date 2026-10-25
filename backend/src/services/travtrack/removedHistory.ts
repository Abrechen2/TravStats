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

/** The history `where` (a condition on `travtrack_points` of this account) is about to lose. */
export async function collectRemoved(
  tx: DbTransaction,
  userId: string,
  where: Prisma.Sql
): Promise<RemovedHistory> {
  const scope = Prisma.sql`user_id = ${userId} AND (${where})`;
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM travtrack_points WHERE ${scope}`;
  if (n === 0n) return NOTHING_REMOVED;
  const days = await tx.$queryRaw<{ day: string }[]>`
    SELECT DISTINCT to_char(t, 'YYYY-MM-DD') AS day FROM travtrack_points
     WHERE ${scope} ORDER BY day`;
  const spans = await tx.$queryRaw<{ from_t: Date; to_t: Date }[]>`
    SELECT min(t) AS from_t, max(t) AS to_t FROM (
      SELECT t, sum(fresh) OVER (ORDER BY t) AS grp FROM (
        SELECT t,
               CASE WHEN lag(t) OVER (ORDER BY t) IS NULL
                      OR t - lag(t) OVER (ORDER BY t) >= ${SPAN_JOIN_MS} * interval '1 millisecond'
                    THEN 1 ELSE 0 END AS fresh
          FROM travtrack_points WHERE ${scope}
      ) marked
    ) grouped
    GROUP BY grp ORDER BY from_t`;
  let keys: Set<string> | null = null;
  if (n <= BigInt(KEY_CAP)) {
    const rows = await tx.$queryRaw<{ t_s: number; lat: number; lon: number }[]>`
      SELECT t_s, lat, lon FROM travtrack_points WHERE ${scope}`;
    keys = new Set(rows.map((r) => positionKey({ tS: r.t_s, lat: r.lat, lon: r.lon })));
  }
  return {
    spans: spans.map((s) => [s.from_t.getTime(), s.to_t.getTime()]),
    days: days.map((d) => d.day),
    keys,
  };
}
