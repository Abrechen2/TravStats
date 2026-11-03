import type { NextFunction, Response } from "express";

import { prisma } from "../../db";
import type { AuthRequest } from "../../middleware/auth";
import { getCachedAirports } from "../../services/airportCache";
import { enrichFlightsForClients } from "../../services/flightAirportFacts";

/**
 * `GET /flights/next` — the single soonest upcoming flight, for the dashboard
 * "next flight" block and the Companion's departure reminders.
 *
 * "Upcoming" is departureTime in the future, ascending — the opposite order to
 * the list endpoint, which is why this is its own route rather than a query
 * flag. Status is not trusted here: the nightly sweep only reverts strictly
 * future rows to `scheduled`, so a future flight still stored as `flown`
 * (imported that way, or seeded) would be missed by a status filter. The time
 * is the source of truth, matching deriveFlightStatus.
 *
 * The flight carries `times` and both zones (forgejo#132, 2026-09-27): the
 * Companion schedules reminders from this projection, and the bare
 * `departureTime` of a LEGACY_FAKE_UTC row is the airport's wall clock posing
 * as an instant — a reminder off by the airport's offset. Lifted out of
 * `routes/flights.ts`, which is frozen at its size and may only shrink.
 *
 * Returns { flight: null } when there is nothing ahead — the block hides.
 */

const NEXT_FLIGHT_SELECT = {
  id: true,
  airline: true,
  airlineIata: true,
  flightNumber: true,
  depIata: true,
  depIcao: true,
  arrIata: true,
  arrIcao: true,
  departureTime: true,
  arrivalTime: true,
  depTimeSemantics: true,
  arrTimeSemantics: true,
  depTimezone: true,
  arrTimezone: true,
  depPrecision: true,
  arrPrecision: true,
  actualDeparture: true,
  actualArrival: true,
  runwayDepartureTime: true,
  runwayArrivalTime: true,
  onlineCheckInOpensAt: true,
  onlineCheckInZone: true,
  tripId: true,
} as const;

/** Largest gap between a fake-UTC wall clock and its real instant, with margin. */
const FAKE_UTC_SKEW_MS = 16 * 60 * 60 * 1000;
/** Rows read per request; far more than can sit inside the skew window. */
const CANDIDATE_LIMIT = 50;

export const nextFlightHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.userId!;
    // The stored departureTime is not always an instant: a LEGACY_FAKE_UTC row
    // holds the airport's wall clock posing as UTC, up to ~14 h away from the
    // real moment. Comparing it with `now` flipped a west-of-UTC flight early
    // or late, so the DB filter is widened by that skew and the real instant
    // (`times.departure.utc`, the same reading every client gets) decides.
    const now = Date.now();
    const candidates = await prisma.flight.findMany({
      where: {
        userId,
        status: { not: "cancelled" },
        departureTime: { gte: new Date(now - FAKE_UTC_SKEW_MS) },
      },
      orderBy: [{ departureTime: "asc" }, { id: "asc" }],
      take: CANDIDATE_LIMIT,
      select: NEXT_FLIGHT_SELECT,
    });
    const enrichedAll = await enrichFlightsForClients(candidates);
    const upcoming = enrichedAll
      .map((f, i) => ({
        row: candidates[i],
        enriched: f,
        at: f.times.departure ? Date.parse(f.times.departure.utc) : NaN,
      }))
      .filter((c) => Number.isFinite(c.at) && c.at >= now)
      .sort((a, b) => a.at - b.at || (a.row.id < b.row.id ? -1 : 1));
    const best = upcoming[0];

    if (!best) {
      res.json({ flight: null });
      return;
    }
    const { row, enriched } = best;

    // City/country of both ends in one batched lookup, same source the map
    // overlays use, so the block can read "München → New York".
    const codes = [row.depIata, row.arrIata].filter((c): c is string => !!c);
    const airports = codes.length ? await getCachedAirports(codes) : new Map();
    const end = (iata: string | null): { city: string | null; country: string | null } => {
      const a = iata ? airports.get(iata.toUpperCase()) : undefined;
      return { city: a?.city ?? null, country: a?.country ?? null };
    };

    // No duration here on purpose: this block is a narrow projection for a
    // countdown, not a flight time. The provider columns read only to build
    // `times` stay out of the payload for the same reason.
    res.json({
      flight: {
        id: row.id,
        airline: row.airline,
        airlineIata: row.airlineIata,
        flightNumber: row.flightNumber,
        depIata: row.depIata,
        arrIata: row.arrIata,
        departureTime: row.departureTime,
        arrivalTime: row.arrivalTime,
        depTimeSemantics: row.depTimeSemantics,
        arrTimeSemantics: row.arrTimeSemantics,
        depTimezone: enriched.depTimezone,
        arrTimezone: enriched.arrTimezone,
        times: enriched.times,
        tripId: row.tripId,
        departure: end(row.depIata),
        arrival: end(row.arrIata),
      },
    });
  } catch (error) {
    next(error);
  }
};
