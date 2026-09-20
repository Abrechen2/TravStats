import type { NextFunction, Response } from "express";

import { prisma } from "../../db";
import type { AuthRequest } from "../../middleware/auth";
import { flightQuerySchema } from "../../schemas/flight";
import { enrichFlightsWithAirportFacts } from "../../services/flightAirportFacts";
import { buildFlightOrderBy } from "./listOrder";
import {
  buildFlightWhere,
  departureYearSpan,
  normalizeQueryParams,
  splitMultiValue,
} from "./queryFilters";

/**
 * `GET /flights` — one page of the logbook.
 *
 * Lifted out of `routes/flights.ts` because that file is frozen at its size
 * in `scripts/file-size-baseline.json` and may only shrink, and because this
 * handler is where server-side paging actually happens: filtering, ordering
 * and counting all belong to the same decision and now sit in one file with
 * `listOrder.ts` and `queryFilters.ts` beside it.
 */
export const flightListHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.userId!;
    const normalizedQuery = normalizeQueryParams(
      req.query as Record<string, string | string[] | undefined>
    );
    const parsedQuery = flightQuerySchema.parse(normalizedQuery);
    const tagsArray = splitMultiValue(parsedQuery.tags as string | string[] | undefined);
    // ?all=true bypasses the 500-row cap entirely so API consumers can sync
    // the full row set in one request. Auth + user-scoped where clause make
    // an unbounded read safe; the only consumer is the row owner.
    const all = parsedQuery.all === true;
    const cappedLimit = Math.min(parsedQuery.limit ?? 100, 500);
    const query = {
      ...parsedQuery,
      tags: tagsArray,
      limit: cappedLimit,
      offset: all ? 0 : parsedQuery.offset,
    };
    const take = all ? undefined : cappedLimit;
    // One extra aggregate, and only for the one filter that needs it: a month
    // named without a year. See `departureYearSpan`.
    const yearSpan =
      query.month !== undefined && query.year === undefined
        ? await departureYearSpan(userId)
        : null;
    const { where, noResults } = buildFlightWhere(query, userId, { yearSpan });

    if (noResults) {
      res.json({
        flights: [],
        total: 0,
        limit: take ?? 0,
        offset: query.offset,
        all,
      });
      return;
    }

    const [flights, total] = await Promise.all([
      prisma.flight.findMany({
        where,
        // Whitelisted sort key, always with a tie-breaker that makes the order
        // total — see `listOrder.ts` for why every key needs one.
        orderBy: buildFlightOrderBy(query.sort, query.order),
        skip: query.offset,
        take,
        include: {
          trip: { select: { id: true, name: true, color: true } },
        },
      }),
      prisma.flight.count({ where }),
    ]);

    // One rule for every flight read path — see services/flightAirportFacts.ts.
    // The `durationMinutes` it attaches OVERRIDES the raw `duration_minutes`
    // column carried in by the spread, so no client ever sees the raw NULL a
    // LEGACY_FAKE_UTC pair stores (forgejo#45). A null here still means
    // "no duration" (#106A: a DATE_ONLY row's 12:00 is a placeholder, not a
    // clock) and the display layer draws its labelled estimate — never a 0.
    const enrichedFlights = await enrichFlightsWithAirportFacts(flights);

    res.json({
      flights: enrichedFlights,
      total,
      limit: take ?? total,
      offset: query.offset,
      all,
    });
  } catch (error) {
    next(error);
  }
};
