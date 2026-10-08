import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import type { StayListQuery } from "../../schemas/lodging";
import { withStayTimes } from "./timesDto";

export const STAY_LIST_DEFAULT_LIMIT = 25;

/**
 * The stay's check-in / end day as the CALENDAR day (ADR 0002): the day column
 * where the row has one, the legacy UTC anchor's date only where it does not
 * (a row the backfill has not reached). The filter, the order and what `times`
 * shows are therefore the same day - they used to be three readings of it.
 */
const CHECK_IN_DAY = Prisma.sql`COALESCE(s.check_in_date, s.check_in::date)`;
/** Where the stay ends: its check-out day, or its check-in day when it has no check-out. */
const END_DAY = Prisma.sql`COALESCE(s.check_out_date, s.check_out::date, s.check_in_date, s.check_in::date)`;

/**
 * The conditions of one request, as SQL: whose stays, which trip, and the
 * window `[from, to]` (both ends inclusive).
 *
 * A stay touches the window when it starts on or before `to` and ends on or
 * after `from`. This is a deliberately COARSE superset - an adjacent
 * check-out/check-in day is returned too - because the exact overlap rule is
 * `shared/lodgingOverlap.ts`, applied to these rows by whoever asked. An
 * undated stay has no day and so touches no window.
 */
function stayListConditions(userId: string, query: StayListQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`s.user_id = ${userId}`];
  if (query.tripId !== undefined) conditions.push(Prisma.sql`s.trip_id = ${query.tripId}`);
  if (query.to !== undefined) conditions.push(Prisma.sql`${CHECK_IN_DAY} <= ${query.to}::date`);
  if (query.from !== undefined) conditions.push(Prisma.sql`${END_DAY} >= ${query.from}::date`);
  return Prisma.join(conditions, " AND ");
}

/**
 * One page of the account's stays across all its houses, each carrying the
 * house it belongs to and the trip it is linked to, in check-in-day order with
 * the undated ones last. `id` breaks ties: a day is not unique, and paging on a
 * non-total order skips and repeats rows at the page boundary.
 *
 * The order is decided in SQL because Prisma's `orderBy` cannot coalesce two
 * columns; the rows themselves are then read with their relations and put back
 * in that order (the same shape `routes/lodging.ts` uses for the house list).
 */
export async function queryStayPage(userId: string, query: StayListQuery) {
  const conditions = stayListConditions(userId, query);
  const direction = query.order === "asc" ? Prisma.raw("ASC") : Prisma.raw("DESC");
  const limit = query.limit ?? STAY_LIST_DEFAULT_LIMIT;
  const offset = query.offset ?? 0;

  const [counted, page] = await Promise.all([
    prisma.$queryRaw<Array<{ total: number }>>(
      Prisma.sql`SELECT count(*)::int AS total FROM lodging_stays s WHERE ${conditions}`
    ),
    prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT s.id FROM lodging_stays s WHERE ${conditions}
        ORDER BY ${CHECK_IN_DAY} ${direction} NULLS LAST, s.id ${direction}
        LIMIT ${limit} OFFSET ${offset}`
    ),
  ]);

  const ids = page.map((row) => row.id);
  const stays = await prisma.lodgingStay.findMany({
    // `userId` again: ownership belongs in the query that reads the row.
    where: { id: { in: ids }, userId },
    include: {
      lodging: {
        select: {
          id: true,
          name: true,
          type: true,
          city: true,
          country: true,
          // What the stay editor needs to open from this list: the chain
          // decides the covering loyalty card, the country the starting currency.
          chainId: true,
          isoCountryCode: true,
        },
      },
      trip: { select: { id: true, name: true } },
    },
  });
  const byId = new Map(stays.map((stay) => [stay.id, stay]));
  const rows = ids.flatMap((id) => {
    const stay = byId.get(id);
    return stay === undefined ? [] : [withStayTimes(stay)];
  });
  return { total: counted[0]?.total ?? 0, rows };
}
