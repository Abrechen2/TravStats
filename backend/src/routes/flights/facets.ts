import type { NextFunction, Response } from "express";

import { prisma } from "../../db";
import type { AuthRequest } from "../../middleware/auth";
import { flightQuerySchema } from "../../schemas/flight";
import { groupAirlines } from "../../shared/airlineNormalize";
import { airlineResolvers } from "../../utils/airlineNormalize";
import { localDepartureYearCounts } from "./departureLocalDay";
import { normalizeQueryParams, resolveFlightWhere, splitMultiValue } from "./queryFilters";

/**
 * `GET /flights/facets` — the option lists and the headline figures the
 * logbook draws around its table.
 *
 * It exists because those two things were the reason the page could not
 * paginate. The year and airline dropdowns were built from the COMPLETE row
 * set, and so was the "123 Flüge · 5 Airlines · 30 Flughäfen" strip above the
 * table, so the page had to hold every flight the account owns whatever the
 * table showed (measured 2026-09-20: a `limit=500` loop until exhausted).
 * Counting is the database's job; this endpoint is where it goes.
 *
 * Standard faceting: each option list is counted under every OTHER filter but
 * not its own. Picking Lufthansa must not reduce the airline list to
 * Lufthansa — you would never get back out — while it should narrow the year
 * list to the years you flew with them. The summary is different and applies
 * ALL filters, because it describes the table as the reader sees it; that is
 * the promise `ListSummaryStrip` makes in its own name.
 */

/** One option in a filter dropdown, with how many rows carry it. */
export interface FlightFacetOption<T extends string | number> {
  value: T;
  count: number;
}

export interface FlightFacetsResponse {
  /** Departure years present under the current filters, newest first. */
  years: FlightFacetOption<number>[];
  /** Carrier names as stored, most flights first, then alphabetically. */
  airlines: FlightFacetOption<string>[];
  summary: {
    flights: number;
    /** Distinct carriers by the one identity rule — see `groupAirlines`. */
    airlines: number;
    /** Distinct IATA codes across both ends of the filtered flights. */
    airports: number;
    /** Rows that name no carrier at all, so the count can say what it omits. */
    withoutAirline: number;
  };
}

/**
 * Carriers offered in the dropdown, capped. An account with more distinct
 * spellings than this has a data problem the filter bar cannot solve, and an
 * unbounded list would be the endpoint repeating the mistake it removes.
 */
const MAX_AIRLINE_OPTIONS = 300;

export const flightFacetsHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.userId!;
    const parsed = flightQuerySchema.parse(
      normalizeQueryParams(req.query as Record<string, string | string[] | undefined>)
    );
    const query = {
      ...parsed,
      tags: splitMultiValue(parsed.tags as string | string[] | undefined),
    };

    const build = (overrides: Partial<typeof query>) =>
      resolveFlightWhere({ ...query, ...overrides }, userId);

    const [all, withoutYear, withoutAirlineFilter] = await Promise.all([
      build({}),
      build({ year: undefined }),
      build({ airline: undefined, airlineExact: undefined }),
    ]);

    const [years, airlineRows, flights, identityRows, depCodes, arrCodes] = await Promise.all([
      // Counted on the DEPARTURE AIRPORT'S calendar, like the date the row
      // beside the filter draws and like `/stats` — see `departureLocalDay.ts`
      // for why that is not a `groupBy`.
      withoutYear.noResults ? Promise.resolve([]) : localDepartureYearCounts(withoutYear.where),
      withoutAirlineFilter.noResults
        ? Promise.resolve([])
        : prisma.flight.groupBy({
            by: ["airline"],
            where: withoutAirlineFilter.where,
            _count: true,
          }),
      all.noResults ? Promise.resolve(0) : prisma.flight.count({ where: all.where }),
      all.noResults
        ? Promise.resolve([])
        : prisma.flight.groupBy({
            by: ["airline", "airlineIata", "airlineIcao"],
            where: all.where,
            _count: true,
          }),
      all.noResults
        ? Promise.resolve([])
        : prisma.flight.groupBy({ by: ["depIata"], where: all.where }),
      all.noResults
        ? Promise.resolve([])
        : prisma.flight.groupBy({ by: ["arrIata"], where: all.where }),
    ]);

    const airlines = airlineRows
      // A row with no carrier is not an option — it would draw as a blank
      // entry that filters to "the flights I never labelled" (forgejo#81).
      // The strip reports those as `withoutAirline` instead.
      .flatMap((row) => (row.airline?.trim() ? [{ value: row.airline, count: row._count }] : []))
      // Frequency, then alphabetical — the same total order `groupAirlines`
      // uses, so two equally common carriers do not swap places between loads.
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, MAX_AIRLINE_OPTIONS);

    // Same airline = same CODE, not same spelling (forgejo#81). The dropdown
    // above deliberately lists SPELLINGS, because that is what it filters on;
    // the headline figure counts carriers, and the two are different numbers
    // for a good reason.
    const { groups, withoutAirline } = groupAirlines(
      identityRows.map((row) => ({
        airline: row.airline,
        airlineIata: row.airlineIata,
        airlineIcao: row.airlineIcao,
        count: row._count,
      })),
      airlineResolvers
    );

    const airportCodes = new Set<string>();
    for (const row of depCodes) if (row.depIata) airportCodes.add(row.depIata);
    for (const row of arrCodes) if (row.arrIata) airportCodes.add(row.arrIata);

    const response: FlightFacetsResponse = {
      years,
      airlines,
      summary: {
        flights,
        airlines: groups.length,
        airports: airportCodes.size,
        withoutAirline,
      },
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
};
