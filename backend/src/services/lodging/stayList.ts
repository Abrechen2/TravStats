import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import type { StayListQuery } from "../../schemas/lodging";
import { withStayTimes } from "./timesDto";

export const STAY_LIST_DEFAULT_LIMIT = 25;

/** A stay anchors its calendar days at UTC midnight (ADR 0002); an explicit `Z` keeps the host zone out of it. */
const dayAnchor = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/**
 * The stays whose span touches `[from, to]`, both ends inclusive.
 *
 * A stay with a check-out touches the window when it starts on or before `to`
 * and ends on or after `from`; one with only a check-in (a month/year-precision
 * placeholder, or a day stay saved without its end) touches it when that day
 * lies inside. This is a deliberately COARSE superset - an adjacent
 * check-out/check-in day is returned too - because the exact overlap rule is
 * `shared/lodgingOverlap.ts`, applied to these rows by whoever asked.
 */
export function stayListWhere(userId: string, query: StayListQuery): Prisma.LodgingStayWhereInput {
  const and: Prisma.LodgingStayWhereInput[] = [];
  if (query.to !== undefined) and.push({ checkIn: { lte: dayAnchor(query.to) } });
  if (query.from !== undefined) {
    const from = dayAnchor(query.from);
    and.push({ OR: [{ checkOut: { gte: from } }, { checkOut: null, checkIn: { gte: from } }] });
  }
  return {
    userId,
    ...(query.tripId !== undefined && { tripId: query.tripId }),
    ...(and.length > 0 && { AND: and }),
  };
}

/**
 * One page of the account's stays across all its houses, each carrying the
 * house it belongs to and the trip it is linked to, in check-in order with the
 * undated ones last. `id` breaks ties: check-in is not unique, and paging on a
 * non-total order skips and repeats rows at the page boundary.
 */
export async function queryStayPage(userId: string, query: StayListQuery) {
  const where = stayListWhere(userId, query);
  const direction = query.order ?? "desc";
  const [total, rows] = await Promise.all([
    prisma.lodgingStay.count({ where }),
    prisma.lodgingStay.findMany({
      where,
      orderBy: [{ checkIn: { sort: direction, nulls: "last" } }, { id: direction }],
      take: query.limit ?? STAY_LIST_DEFAULT_LIMIT,
      skip: query.offset ?? 0,
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
    }),
  ]);
  return { total, rows: rows.map(withStayTimes) };
}
