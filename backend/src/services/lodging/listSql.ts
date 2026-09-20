/**
 * The lodging list's derived values, restated once in SQL.
 *
 * WHY THIS FILE EXISTS. The list endpoint used to load the FULL filtered set
 * with `LODGING_INCLUDE`, derive nights/rating/spend per house in JavaScript,
 * sort the array and only then `.slice()` the requested page — `take`/`skip`
 * never reached the Prisma call. The audit of 2026-09-19 measured the cost:
 * the browser's own client compounded it by walking `limit=500` pages until
 * exhausted, so one visit to /lodging read every lodging and every stay of the
 * account, twice over, to draw twenty-five rows. Ordering by a derived value
 * is the reason it could not be paginated, so the derivation has to move to
 * where the rows are.
 *
 * WHY IT IS A SECOND SPELLING, AND WHAT KEEPS IT HONEST. The project rule is
 * that a counting rule has exactly one home (`shared/lodgingCounting.ts`,
 * `shared/lodgingSpendBase.ts`, `shared/lodgingTiming.ts`). That rule is not
 * suspended here: those modules remain the ONE answer, and every figure a row
 * DISPLAYS is still computed by them in `computeAggregates`. What lives here
 * is the same predicate expressed for the database, and it exists only to
 * ORDER, FILTER and TOTAL without loading the set. A restatement that nothing
 * checks is how two numbers come to disagree, so `listSql.parity.test.ts`
 * pins every expression below against its TypeScript original on a fixture —
 * the same guard the backend↔frontend mirrors carry, applied across the
 * language boundary instead.
 *
 * `s` is the alias every fragment expects for `lodging_stays`.
 */

import { Prisma } from "../../prisma";

/**
 * "Does this stay count?" — `shared/lodgingCounting.ts` `classifyStay`, in SQL.
 *
 * Reading the branches against the TypeScript, in its order:
 *
 *  - `deriveLodgingStatus` passes a stored "cancelled" through untouched, and
 *    `classifyStay` maps it to `excluded`. That is the first test here too,
 *    because it is a user STATEMENT and must beat every date.
 *  - With no dates at all, the deriver has nothing to derive from and returns
 *    the stored status, so only a stored "completed" is a visit. An undated
 *    stay is one recorded after the fact; the column's default says so.
 *  - Otherwise: `completed` iff `now >= start AND now >= end`, where
 *    `start = checkIn ?? checkOut` and `end = checkOut ?? checkIn`. That pair
 *    is exactly `GREATEST(check_in, check_out)` — Postgres' GREATEST skips
 *    NULLs, which is what the two coalesces do. The `now < start` guard in the
 *    TypeScript is therefore not a separate branch but the other half of this
 *    comparison, and writing it as one keeps a check-out dated before its
 *    check-in reading "scheduled" on both sides rather than "completed" on one.
 *
 * Deliberately NOT reading `s.status` for the dated case: that column is a
 * cache converged by an hourly sweep, and the whole point of the deriver is to
 * make the answer independent of when the sweep last ran.
 */
export function stayCountsSql(now: Date): Prisma.Sql {
  return Prisma.sql`(
    s.status <> 'cancelled'
    AND CASE
          WHEN s.check_in IS NULL AND s.check_out IS NULL THEN s.status = 'completed'
          ELSE ${now}::timestamp >= GREATEST(s.check_in, s.check_out)
        END
  )`;
}

/**
 * A stay's night count — `shared/lodgingTiming.ts` `resolveStayTiming().nights`.
 *
 * Both ends present AND the day is real: the dates ARE the answer and they beat
 * the explicit column, so a stale number cannot outlive an edited date. The
 * precision test spells out `normalizePrecision`'s fallback — an unrecognised
 * value reads as DAY, a literal 'NONE' does not, and `MONTH`/`YEAR` store
 * placeholder dates whose difference is fiction (AUD-083).
 *
 * `check_out::date - check_in::date` is `daySpan`: the columns are
 * `timestamp` without time zone holding a UTC-pinned midnight, so the cast
 * takes the same UTC date parts `Date.UTC(...)` does on the other side. No
 * session time zone can move it.
 *
 * Everything else falls back to the explicit column, and to 0 when even that is
 * missing — `nightsKnown` is the distinction between "a same-day stay" and
 * "nobody knows", and a SUM cannot carry it. That is why this file exposes
 * nights for TOTALS only; the per-row figure still comes from the TypeScript.
 */
export function stayNightsSql(): Prisma.Sql {
  return Prisma.sql`(
    CASE
      WHEN s.check_in IS NOT NULL AND s.check_out IS NOT NULL
           AND (s.date_precision = 'DAY'
                OR s.date_precision NOT IN ('DAY', 'MONTH', 'YEAR', 'NONE'))
        THEN GREATEST(0, s.check_out::date - s.check_in::date)
      WHEN s.nights IS NOT NULL AND s.nights >= 0 THEN s.nights
      ELSE 0
    END
  )`;
}

/**
 * A stay's amount IN the account's base currency —
 * `shared/lodgingSpendBase.ts` `lodgingBaseAmount`. NULL where nothing honest
 * can be said, so SUM skips it exactly as the TypeScript's null check does.
 *
 * The own-currency branch is tried FIRST and on purpose: a stay priced in the
 * base currency counts at its own price even where a snapshot names another
 * currency, because an account that moved its base currency and moved back
 * holds exactly such rows and there the snapshot is the stale reading. A
 * missing `currency` reads as EUR, mirroring the `?? "EUR"` on the other side
 * (the column is NOT NULL with that default, so the branch is defensive).
 */
export function stayBaseAmountSql(baseCurrency: string): Prisma.Sql {
  return Prisma.sql`(
    CASE
      WHEN s.total_price IS NOT NULL AND COALESCE(s.currency, 'EUR') = ${baseCurrency}
        THEN s.total_price
      WHEN s.total_price_base IS NOT NULL AND s.fx_base_currency = ${baseCurrency}
        THEN s.total_price_base
      ELSE NULL
    END
  )`;
}

/**
 * The day a stay is attributed to — `shared/lodgingTiming.ts`'s `anchor`, which
 * is what `lib/lodgingLatestStay.ts` maxes over to give a house its one date.
 *
 * `checkIn ?? checkOut`, and NULL at NONE precision. Note the asymmetry with
 * the counting predicate above: this reads EVERY stay, planned and cancelled
 * alike, because "last stay" is the newest thing on the record and a booking
 * for next month belongs above a visit from last year.
 */
export function stayAnchorSql(): Prisma.Sql {
  return Prisma.sql`(
    CASE
      WHEN s.date_precision = 'NONE' THEN NULL
      ELSE COALESCE(s.check_in, s.check_out)
    END
  )`;
}

/**
 * The house's lifecycle rank — `shared/lodgingLifecycle.ts`
 * `lodgingLifecycleRank`, as an aggregate over the joined stays.
 *
 * Reads the STORED status column, which is the difference from
 * `stayCountsSql` above and is deliberate: see that module's header.
 * `COUNT(s.id)` rather than `COUNT(*)` because the LEFT JOIN contributes one
 * all-NULL row for a house with no stays, and that house ranks last.
 */
export function lifecycleRankSql(): Prisma.Sql {
  return Prisma.sql`(
    CASE
      WHEN COUNT(s.id) = 0 THEN 4
      WHEN COUNT(*) FILTER (WHERE s.status = 'in_progress') > 0 THEN 0
      WHEN COUNT(*) FILTER (WHERE s.status = 'scheduled') > 0 THEN 1
      WHEN COUNT(*) FILTER (WHERE s.status = 'completed') > 0 THEN 2
      ELSE 3
    END
  )`;
}

/**
 * The average of the counting stays' `ratingOverall`, rounded as
 * `deriveOverallRating` rounds it.
 *
 * `Math.round(avg * 10) / 10`, not `round(avg, 1)`: the two agree on every
 * value either will ever see, but spelling the multiply keeps the two sides
 * reading the same and costs nothing. `AVG` ignores NULLs, which is the
 * `.filter(v => v !== null)` on the other side, and returns NULL for a house
 * with nothing rated — "no rating", never 0.
 */
export function ratingAvgSql(now: Date): Prisma.Sql {
  return Prisma.sql`(
    ROUND((AVG(s.rating_overall) FILTER (WHERE ${stayCountsSql(now)}) * 10)::numeric) / 10
  )`;
}
