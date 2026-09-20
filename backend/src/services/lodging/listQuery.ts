/**
 * Which lodgings are on this page, and how many there are altogether.
 *
 * The list's sort keys are DERIVED — nights, rating, spend and "last stay" all
 * come from the stays, not from a column on `lodgings` — so they could not be
 * pushed into a Prisma `orderBy`. The handler's answer was to load the full
 * filtered set with its stays, derive in JavaScript, sort the array and slice
 * the page out of it: correct, and unbounded. The audit of 2026-09-19 measured
 * what that cost on the way in as well as the way out, because the browser's
 * client walked `limit=500` pages until exhausted, so drawing twenty-five rows
 * read every lodging and every stay of the account.
 *
 * This module answers the same question in one statement: an aggregate over
 * the joined stays, ordered, with LIMIT/OFFSET and the total from the same
 * pass. It returns IDS ONLY. The rows themselves are then read with the
 * ordinary `findMany({ where: { id: { in } }, include: LODGING_INCLUDE })` and
 * re-ordered to that list, so every figure a row DISPLAYS is still derived by
 * `computeAggregates` from the shared rules — the SQL orders and counts, it
 * never becomes a second source for what the user reads. `listSql.parity.test`
 * holds the two spellings together.
 */

import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import type { LodgingQueryInput } from "../../schemas/lodging";
import { LIFECYCLE_SORT_RANK } from "../../shared/lodgingLifecycle";
import {
  lifecycleRankSql,
  ratingAvgSql,
  stayAnchorSql,
  stayBaseAmountSql,
  stayCountsSql,
  stayNightsSql,
} from "./listSql";

/** The server's own page cap, also the maximum `lodgingQuerySchema` accepts. */
export const LODGING_LIST_MAX_LIMIT = 500;
/** What a request without a `limit` gets. Unchanged from the in-memory handler. */
export const LODGING_LIST_DEFAULT_LIMIT = 200;

export interface LodgingPage {
  /** The ids of this page, already in the requested order. */
  ids: string[];
  /** Rows matching the filters, before the page slice. */
  total: number;
}

/**
 * The filters, as one WHERE fragment over `lodgings l` LEFT JOINed to
 * `lodging_chains c`.
 *
 * The WHERE `buildLodgingWhere` used to build for Prisma, in SQL — that helper
 * left `listView.ts` with the in-memory handler. Two of the clauses look like
 * they could be folded into the stay JOIN and must not be: `year` and `tripId`
 * select which HOUSES appear, never which stays count towards their figures.
 * As an EXISTS they leave the aggregate reading every stay, which is what
 * `include: { stays: true }` did on the old path — pushing them into the JOIN
 * would quietly make "hotels I stayed in during 2024" report only 2024’s
 * nights, a different question nobody asked.
 */
export function lodgingFilterSql(q: LodgingQueryInput, userId: string): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`l.user_id = ${userId}`];

  if (q.type) conditions.push(Prisma.sql`l.type = ${q.type}`);
  if (q.chainId !== undefined) conditions.push(Prisma.sql`l.chain_id = ${q.chainId}`);

  // An ISO code covers "Deutschland" AND "Germany" through the derived column;
  // anything else is matched verbatim, because an older client — and a house
  // whose text resolves to no country at all — must keep working.
  if (q.country) {
    if (/^[A-Za-z]{2}$/.test(q.country)) {
      conditions.push(Prisma.sql`l.iso_country_code = ${q.country.toUpperCase()}`);
    } else {
      conditions.push(Prisma.sql`l.country = ${q.country}`);
    }
  }

  if (q.search) {
    // The same three fields the browser used to search over while it held the
    // whole list: the house, its chain and its town. `%` and `_` are escaped
    // so a name containing one is searched for, not used as a wildcard.
    const pattern = `%${q.search.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(Prisma.sql`(
      l.name ILIKE ${pattern}
      OR COALESCE(c.name, '') ILIKE ${pattern}
      OR COALESCE(l.city, '') ILIKE ${pattern}
    )`);
  }

  const stayConditions: Prisma.Sql[] = [];
  if (q.tripId) stayConditions.push(Prisma.sql`s2.trip_id = ${q.tripId}`);
  if (q.year !== undefined) {
    stayConditions.push(
      Prisma.sql`s2.check_in >= ${new Date(`${q.year}-01-01T00:00:00.000Z`)}::timestamp`,
      Prisma.sql`s2.check_in < ${new Date(`${q.year + 1}-01-01T00:00:00.000Z`)}::timestamp`
    );
  }
  if (stayConditions.length > 0) {
    // ONE stay must satisfy all of them together — the same meaning as Prisma's
    // `stays: { some: { tripId, checkIn } }`, not one stay per condition.
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM lodging_stays s2
      WHERE s2.lodging_id = l.id AND ${Prisma.join(stayConditions, " AND ")}
    )`);
  }

  return Prisma.join(conditions, " AND ");
}

/**
 * The ORDER BY for one sort key, in one direction.
 *
 * Every entry restates a comparator from
 * `frontend/src/components/lodging/sortLodgingRows.ts`, including its treatment
 * of the missing value, because a list that reorders itself the moment paging
 * moves to the server is the bug this change would otherwise introduce:
 *
 *  - `chain` and `location` put the unnamed AFTER every named row ascending,
 *    and the browser negated the whole comparison to descend, so the unnamed
 *    lead going the other way. `(x IS NULL)` carries the direction with them.
 *  - `lastStay` keeps undated houses LAST in BOTH directions — they are not
 *    pretending to be the oldest thing in the library.
 *  - `rating` sorts the unrated as -1, below every real rating.
 *
 * `checkIn` is the old API spelling of `lastStay` and stays accepted: it was
 * the only date sort this endpoint ever had, and breaking it would break a
 * consumer to rename a word.
 */
function orderBySql(sort: LodgingQueryInput["sort"], order: "asc" | "desc"): Prisma.Sql {
  const dir = order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  switch (sort) {
    case "name":
      return Prisma.sql`name ${dir}`;
    case "chain":
      return Prisma.sql`(chain_name IS NULL) ${dir}, chain_name ${dir}`;
    case "location":
      return Prisma.sql`(location_key IS NULL) ${dir}, location_key ${dir}`;
    case "status":
      return Prisma.sql`status_rank ${dir}`;
    case "stays":
      return Prisma.sql`stay_count ${dir}`;
    case "nights":
      return Prisma.sql`nights ${dir}`;
    case "rating":
      return Prisma.sql`COALESCE(rating, -1) ${dir}`;
    case "spend":
      return Prisma.sql`spend ${dir}`;
    case "lastStay":
    case "checkIn":
      return Prisma.sql`last_stay ${dir} NULLS LAST`;
    default:
      // No sort asked for: newest house first, as this endpoint always did.
      return Prisma.sql`created_at ${dir}`;
  }
}

interface PageRow {
  id: string;
  total: bigint;
}

export async function queryLodgingPage(params: {
  userId: string;
  query: LodgingQueryInput;
  baseCurrency: string;
  now?: Date;
}): Promise<LodgingPage> {
  const { userId, query, baseCurrency } = params;
  const now = params.now ?? new Date();
  const counts = stayCountsSql(now);
  const limit = Math.min(query.limit ?? LODGING_LIST_DEFAULT_LIMIT, LODGING_LIST_MAX_LIMIT);
  const offset = query.offset ?? 0;
  const order = query.order ?? defaultOrderFor(query.sort);

  // The status filter is the one that CANNOT sit in the WHERE: it is a verdict
  // over the whole house, so it is applied to the aggregate. Placing it in the
  // outer WHERE also keeps `count(*) OVER ()` honest — window functions are
  // evaluated after WHERE, so the total is the filtered total.
  const statusFilter =
    query.status === undefined
      ? Prisma.empty
      : Prisma.sql`WHERE status_rank = ${LIFECYCLE_SORT_RANK[query.status]}`;

  const rows = await prisma.$queryRaw<PageRow[]>(Prisma.sql`
    WITH agg AS (
      SELECT l.id,
             l.name,
             l.created_at,
             c.name AS chain_name,
             COALESCE(NULLIF(l.city, ''), NULLIF(l.country, '')) AS location_key,
             ${lifecycleRankSql()} AS status_rank,
             MAX(${stayAnchorSql()}) AS last_stay,
             COUNT(*) FILTER (WHERE ${counts})::int AS stay_count,
             COALESCE(SUM(${stayNightsSql()}) FILTER (WHERE ${counts}), 0)::int AS nights,
             ${ratingAvgSql(now)} AS rating,
             COALESCE(SUM(${stayBaseAmountSql(baseCurrency)}) FILTER (WHERE ${counts}), 0) AS spend
      FROM lodgings l
      LEFT JOIN lodging_chains c ON c.id = l.chain_id
      LEFT JOIN lodging_stays s ON s.lodging_id = l.id
      WHERE ${lodgingFilterSql(query, userId)}
      GROUP BY l.id, c.name
    )
    SELECT id, COUNT(*) OVER () AS total
    FROM agg
    ${statusFilter}
    -- name then id is the tie-breaker every sort ends on. Without a total
    -- order a LIMIT/OFFSET walk may skip a row on one page and repeat it on
    -- the next, the trap routes/flights.ts records for its own nullable key.
    ORDER BY ${orderBySql(query.sort, order)}, name ASC, id ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return {
    ids: rows.map((r) => r.id),
    // No row means no total — `COUNT(*) OVER ()` had nothing to report from.
    total:
      rows.length === 0 ? await countLodgings(query, userId, statusFilter) : Number(rows[0].total),
  };
}

/**
 * The total when the page came back empty.
 *
 * `COUNT(*) OVER ()` rides on the rows, so a page past the end of the set
 * carries no total at all — and answering 0 there would tell a client that had
 * simply paged too far that its filter matches nothing. One extra statement,
 * only on that path.
 */
async function countLodgings(
  query: LodgingQueryInput,
  userId: string,
  statusFilter: Prisma.Sql
): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    WITH agg AS (
      SELECT l.id, ${lifecycleRankSql()} AS status_rank
      FROM lodgings l
      LEFT JOIN lodging_chains c ON c.id = l.chain_id
      LEFT JOIN lodging_stays s ON s.lodging_id = l.id
      WHERE ${lodgingFilterSql(query, userId)}
      GROUP BY l.id
    )
    SELECT COUNT(*) AS total FROM agg ${statusFilter}
  `);
  return Number(row.total);
}

/**
 * Which way a key reads on its first click — the browser's
 * `LODGING_SORT_DEFAULT_ASC`, so a request that names a sort and no direction
 * gets what the table would have shown.
 */
export function defaultOrderFor(sort: LodgingQueryInput["sort"]): "asc" | "desc" {
  return sort === "name" || sort === "chain" || sort === "location" || sort === "status"
    ? "asc"
    : "desc";
}
