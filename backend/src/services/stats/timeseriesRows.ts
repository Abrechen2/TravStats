/**
 * The dated rows `/stats/timeseries` buckets — one fetcher per domain.
 *
 * Lifted out of `routes/stats.ts` unchanged, the way `departureClock.ts` was:
 * that file is frozen at 2450 lines in `scripts/file-size-baseline.json` and
 * had grown past it, and these two fetchers are the one part of the route
 * that asks a data question rather than an HTTP one. The window is still
 * decided in the route (`withinWindow` there), because the flight fetcher
 * over-fetches on purpose and only the caller knows the local edge.
 */

import { prisma } from "../../db";
import { calculateDistance } from "../../utils/geo";
import { localWallClockOf, type FlightTimeSemantics } from "../../utils/timezone";
import { measuredDurationMinutes } from "../../utils/flightDurationColumn";
import { resolveFlightDuration } from "../../shared/flightDuration";
import { countableFlightWhere } from "../../shared/flightCounting";
import type { DatedRow } from "../../utils/stats/timeseries";
import { buildTzMap } from "./departureClock";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The calendar day a flight departed on, as the departure airport's clock saw
 * it, expressed as that day's UTC midnight so the existing bucketing arithmetic
 * keeps working unchanged.
 */
const airportCalendarDay = (
  stored: Date,
  timezone: string | null,
  semantics: FlightTimeSemantics,
): Date => new Date(`${localWallClockOf(stored, timezone, semantics).date}T00:00:00Z`);

export async function fetchFlightDatedRows(
  userId: string,
  from: Date,
  to: Date,
): Promise<DatedRow[]> {
  const rows = await prisma.flight.findMany({
    where: {
      userId,
      ...countableFlightWhere(),
      // Widened by a day at each edge ON PURPOSE. The query can only filter the
      // stored INSTANT, while a bucket is the departure airport's calendar day,
      // and the two disagree by up to fourteen hours. Without the margin a
      // flight leaving Bangkok early on 1 January is fetched as 31 December UTC
      // and never appears in the year it departed. The margin rows are removed
      // again by `withinWindow` once their local day is known — see the route.
      departureTime: { gte: new Date(from.getTime() - DAY_MS), lt: new Date(to.getTime() + DAY_MS) },
    },
    select: {
      depIata: true, depIcao: true, depLat: true, depLon: true,
      arrIata: true, arrIcao: true, arrLat: true, arrLon: true,
      departureTime: true, arrivalTime: true,
      depTimeSemantics: true, arrTimeSemantics: true,
      durationMinutes: true,
      status: true,
    },
  });
  const tzMap = await buildTzMap(rows);
  return rows.map((f) => {
    const depTz = (f.depIata && tzMap.get(f.depIata)) || (f.depIcao && tzMap.get(f.depIcao)) || null;
    const arrTz = (f.arrIata && tzMap.get(f.arrIata)) || (f.arrIcao && tzMap.get(f.arrIcao)) || null;
    const measuredMin =
      f.status === "flown" ? measuredDurationMinutes(f, depTz, arrTz) : null;
    // Same rule as `/stats/summary` and the overview card (#268): measured
    // where there are clocks, estimated from the coordinates where there are
    // not. This used to be a bare 0, which is why the scorecard tile and the
    // card above it reported different totals for the same flights.
    const durationMin =
      resolveFlightDuration({
        measuredMinutes: measuredMin,
        depLat: f.depLat, depLon: f.depLon, arrLat: f.arrLat, arrLon: f.arrLon,
      })?.minutes ?? 0;
    return {
      // The airport's calendar day, not the UTC instant — Forgejo #46. Every
      // other "when did I fly" figure on this server reads the clock at the
      // departure airport (`/stats/countries`, `/stats/fun`), and the OpenAPI
      // for this endpoint already promised the same. It did not do it: an
      // evening departure east of UTC landed in the previous period, so the
      // countries list and the trend chart disagreed about which year a flight
      // belonged to.
      date: airportCalendarDay(
        f.departureTime as Date,
        depTz,
        f.depTimeSemantics as FlightTimeSemantics,
      ),
      distanceKm: calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon),
      durationMin,
    };
  });
}

export async function fetchCruiseDatedRows(
  userId: string,
  from: Date,
  to: Date,
): Promise<DatedRow[]> {
  const rows = await prisma.cruise.findMany({
    // Sailed cruises only — the same done-predicate /stats/cruise uses, and
    // the very leak `stats.cruiseScheduledLeak.test.ts` was written for. This
    // twin kept `not: cancelled`, so a merely BOOKED cruise contributed both
    // its count and its distance. Latent so far (the UI only asks for the
    // flight series), which is exactly how it survived the fix next door.
    where: {
      userId,
      ...countableFlightWhere(),
      startDate: { gte: from, lt: to },
    },
    select: { startDate: true, legs: { select: { distanceKm: true } } },
  });
  return rows.map((c) => ({
    date: c.startDate as Date,
    distanceKm: c.legs.reduce((sum, l) => sum + (l.distanceKm ?? 0), 0),
    durationMin: 0,
  }));
}
