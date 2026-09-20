import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import type { CruiseQueryInput } from "../../schemas/cruise";
import {
  compareCruises,
  cruiseStartPeriod,
  type CruiseOrderRow,
  type CruiseSortField,
} from "../../shared/cruiseListOrder";

/**
 * Query parameters -> a Prisma `where`, and the ordering pass the cruise list
 * cannot push into one.
 *
 * Lifted out of `routes/cruises.ts`, which is 50 lines under the file-size
 * limit and would not have survived this. The split is the same seam
 * `routes/flights/queryFilters.ts` uses: everything here turns request text
 * into a selection, and none of it touches a response.
 */

const like = (value: string) => ({ contains: value, mode: "insensitive" as const });

/**
 * The columns a cruise row shows, as one OR.
 *
 * Wider than the search it replaces, on purpose. The browser matched ship
 * name and line only, because those were the two strings it had in hand; a
 * reader searching "Kiel" for the sailing that left from there got nothing.
 * The server can reach the ports, so it does.
 */
const freeTextFilter = (needle: string): Prisma.CruiseWhereInput => ({
  OR: [
    { shipNameOverride: like(needle) },
    { cruiseLine: like(needle) },
    { routeName: like(needle) },
    { bookingReference: like(needle) },
    { ship: { name: like(needle) } },
    { ship: { cruiseLine: like(needle) } },
    { departurePort: { name: like(needle) } },
    { departurePort: { city: like(needle) } },
    { departurePort: { unlocode: like(needle) } },
    { arrivalPort: { name: like(needle) } },
    { arrivalPort: { city: like(needle) } },
    { arrivalPort: { unlocode: like(needle) } },
    { stops: { some: { port: { name: like(needle) } } } },
    { stops: { some: { port: { city: like(needle) } } } },
    { stops: { some: { port: { unlocode: like(needle) } } } },
    // A port the importer could not match to the catalogue is still a place
    // the ship called at, and its name is the only record of it.
    { stops: { some: { unresolvedPortName: like(needle) } } },
  ],
});

/**
 * "This line", by the rule the row cell draws: the cruise's own `cruiseLine`
 * if it has one, otherwise the ship's.
 *
 * The `cruiseLine` parameter next to it matches the COLUMN alone and stays
 * that way for the clients that already send it. That is not the question the
 * filter dropdown asks: a cruise whose line is only known through its ship
 * appears in the dropdown (it is `ship.cruiseLine` there too) and would then
 * select nothing.
 */
const lineFilter = (line: string): Prisma.CruiseWhereInput => ({
  OR: [{ cruiseLine: line }, { cruiseLine: null, ship: { cruiseLine: line } }],
});

export const buildCruiseWhere = (
  query: CruiseQueryInput,
  userId: string
): { where: Prisma.CruiseWhereInput; noResults: boolean } => {
  const and: Prisma.CruiseWhereInput[] = [{ userId }];
  let noResults = false;

  const statuses = Array.isArray(query.status) ? query.status : query.status ? [query.status] : [];
  if (Array.isArray(query.status) && query.status.length === 0) noResults = true;
  else if (statuses.length === 1) and.push({ status: statuses[0] });
  else if (statuses.length > 1) and.push({ status: { in: statuses } });

  const lines = Array.isArray(query.cruiseLine)
    ? query.cruiseLine
    : query.cruiseLine
      ? [query.cruiseLine]
      : [];
  if (lines.length === 1) and.push({ cruiseLine: lines[0] });
  else if (lines.length > 1) and.push({ cruiseLine: { in: lines } });

  if (query.shipLine) and.push(lineFilter(query.shipLine));
  if (query.tripId) and.push({ tripId: query.tripId });
  if (query.q) and.push(freeTextFilter(query.q));
  if (query.region) {
    const region = query.region;
    and.push({
      OR: [
        { departurePort: { region } },
        { arrivalPort: { region } },
        { stops: { some: { port: { region } } } },
      ],
    });
  }

  // `year` and `month` are deliberately absent — see `loadCruiseOrderRows`.
  return { where: { AND: and }, noResults };
};

/**
 * Every cruise matching `where`, reduced to what ordering and the calendar
 * filter need.
 *
 * This is the scan, and it is the honest cost of four sort keys that are not
 * columns (`shared/cruiseListOrder.ts` names them). It reads no port rows, no
 * legs, no trip and no notes — the list's own `include` pulls all of those,
 * and the page used to pay for it on EVERY cruise in the account because the
 * browser did the sorting. Now the wide read is one page.
 */
export async function loadCruiseOrderRows(
  where: Prisma.CruiseWhereInput
): Promise<CruiseOrderRow[]> {
  const rows = await prisma.cruise.findMany({
    where,
    select: {
      id: true,
      startDate: true,
      price: true,
      status: true,
      shipNameOverride: true,
      cruiseLine: true,
      departurePortId: true,
      arrivalPortId: true,
      ship: { select: { name: true, cruiseLine: true } },
      stops: { select: { isAtSea: true, portId: true } },
    },
  });

  return rows.map((row) => {
    // `countUniquePorts`, server side: departure, arrival and every MATCHED
    // port call, de-duplicated. An unresolved stop is left out for the reason
    // that function gives — it cannot be de-duplicated against a matched port
    // of the same name, so counting it would double a place visited once.
    const portIds = new Set<number>();
    if (row.departurePortId !== null) portIds.add(row.departurePortId);
    if (row.arrivalPortId !== null) portIds.add(row.arrivalPortId);
    for (const stop of row.stops) {
      if (stop.isAtSea || stop.portId === null) continue;
      portIds.add(stop.portId);
    }
    return {
      id: row.id,
      startDate: row.startDate,
      price: row.price,
      status: row.status,
      shipName: row.ship?.name ?? null,
      shipNameOverride: row.shipNameOverride,
      cruiseLine: row.cruiseLine,
      shipCruiseLine: row.ship?.cruiseLine ?? null,
      uniquePortCount: portIds.size,
    };
  });
}

/**
 * The calendar filter, applied HERE rather than as a date range on
 * `startDate`.
 *
 * One place for one axis. A month named without a year — "every January I
 * have sailed" — cannot be a Prisma `where` at all, and splitting the axis so
 * that `year` is a range and a bare `month` is something else would give the
 * list and the facet two chances to disagree about the same question. The
 * rows are already in hand for the ordering, so this costs nothing.
 */
export function applyCruisePeriod(
  rows: CruiseOrderRow[],
  period: { year?: number; month?: number }
): CruiseOrderRow[] {
  if (period.year === undefined && period.month === undefined) return rows;
  return rows.filter((row) => {
    const started = cruiseStartPeriod(row);
    // An undated cruise belongs to no year. It is left out rather than
    // bucketed, like an undated flight.
    if (!started) return false;
    if (period.year !== undefined && started.year !== period.year) return false;
    if (period.month !== undefined && started.month !== period.month) return false;
    return true;
  });
}

/** The ids of one page, in order. Sort THEN slice, never the other way. */
export function selectCruisePage(
  rows: readonly CruiseOrderRow[],
  sort: CruiseSortField,
  order: "asc" | "desc",
  limit: number,
  offset: number
): string[] {
  return [...rows]
    .sort((a, b) => compareCruises(a, b, sort, order))
    .slice(offset, offset + limit)
    .map((row) => row.id);
}
