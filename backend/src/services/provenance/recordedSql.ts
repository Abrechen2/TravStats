import { Prisma } from "../../prisma";
import { entryFilterActive } from "./recordedOnly";

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
  const { recorded, hidden } = entryFilterActive();
  const parts: Prisma.Sql[] = [];
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
  const { recorded, hidden } = entryFilterActive();
  return recorded || (hidden.LodgingStay?.length ?? 0) > 0
    ? Prisma.sql`(${Prisma.raw(alias)}.id IS NULL OR ${recordedStaySql(alias)})`
    : Prisma.sql`TRUE`;
}
