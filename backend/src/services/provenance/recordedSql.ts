import { Prisma } from "../../prisma";
import { entryFilterActive } from "./recordedOnly";
import { purposeFilterSql } from "../purpose/purposeFilter";

/**
 * "Nur belegte" for the few reads written in raw SQL (the lodging list and its facets). The Prisma
 * hook cannot see inside `$queryRaw`, so these fragments say the same thing in SQL, and only
 * inside an entry-filter scope (recorded-only or a hidden purpose): an unknown provenance stays, as everywhere else.
 */

/**
 * A stay row of alias `alias` the open scope lets through: not a recollection when "nur belegte"
 * is on, and not of a purpose the user hides for lodging; `TRUE` outside a scope.
 */
export function recordedStaySql(alias: string): Prisma.Sql {
  const { recorded, hidden, filter } = entryFilterActive();
  const parts: Prisma.Sql[] = [];
  if (filter) parts.push(purposeFilterSql(alias, filter));
  if (recorded)
    parts.push(Prisma.sql`${Prisma.raw(alias)}.provenance IS DISTINCT FROM 'remembered'`);
  const purposes = hidden.LodgingStay;
  if (purposes && purposes.length > 0) {
    parts.push(
      Prisma.sql`(${Prisma.raw(alias)}.purpose IS NULL OR ${Prisma.raw(alias)}.purpose NOT IN (${Prisma.join(purposes)}))`
    );
  }
  return parts.length === 0 ? Prisma.sql`TRUE` : Prisma.join(parts, " AND ");
}

/**
 * For a `LEFT JOIN lodging_stays s` under a WHERE: keeps the house's rows without a stay (a
 * noted house) and its visible stays. A house whose every stay is filtered out loses all its rows
 * and drops out, like the Prisma side's parent rule.
 */
export function recordedJoinedStaySql(alias: string): Prisma.Sql {
  const { recorded, hidden, filter } = entryFilterActive();
  // Filtered to one purpose, a house stays only through a stay of it (no stay-less rows).
  if (filter)
    return Prisma.sql`(${Prisma.raw(alias)}.id IS NOT NULL AND ${recordedStaySql(alias)})`;
  return recorded || (hidden.LodgingStay?.length ?? 0) > 0
    ? Prisma.sql`(${Prisma.raw(alias)}.id IS NULL OR ${recordedStaySql(alias)})`
    : Prisma.sql`TRUE`;
}
