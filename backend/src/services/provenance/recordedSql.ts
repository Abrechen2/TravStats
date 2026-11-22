import { Prisma } from "../../prisma";
import { recordedOnlyActive } from "./recordedOnly";

/**
 * "Nur belegte" for the few reads written in raw SQL (the lodging list and its facets). The Prisma
 * hook cannot see inside `$queryRaw`, so these fragments say the same thing in SQL, and only
 * inside a recorded-only request: an unknown provenance stays, as everywhere else.
 */

/** A stay row of alias `alias` that is not a recollection; `TRUE` outside a recorded-only scope. */
export function recordedStaySql(alias: string): Prisma.Sql {
  return recordedOnlyActive()
    ? Prisma.sql`${Prisma.raw(alias)}.provenance IS DISTINCT FROM 'remembered'`
    : Prisma.sql`TRUE`;
}

/**
 * For a `LEFT JOIN lodging_stays s` under a WHERE: keeps the house's rows without a stay (a
 * noted house) and its recorded stays. A house whose every stay is remembered loses all its rows
 * and drops out, like the Prisma side's parent rule.
 */
export function recordedJoinedStaySql(alias: string): Prisma.Sql {
  return recordedOnlyActive()
    ? Prisma.sql`(${Prisma.raw(alias)}.id IS NULL OR ${recordedStaySql(alias)})`
    : Prisma.sql`TRUE`;
}
