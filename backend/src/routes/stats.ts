import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { calculateDistance } from '../utils/geo';
import { getCachedAirports } from '../services/airportCache';
import type { AirportData } from '../services/airportLookup';
import { buildFlightNetwork } from '../services/stats/network';
import { computePunctuality } from '../services/punctualityStats';
import { Prisma } from '@prisma/client';
import {
  calculateFunStats,
  calculateBusinessStats,
  calculateUniqueStats,
  calculateAirportStats,
} from '../utils/statsCalculator';
import { calculateCruiseStats, type CruiseData as CruiseStatsInput } from '../utils/cruiseStats';
import { calculateLodgingStats, type LodgingStayData, type LodgingRecord } from '../utils/lodgingStats';
import {
  buildMembershipContext,
  resolveStayProgramme,
} from '../services/lodging/stayMembership';
import { normalizeHistory } from '../utils/homeAirport';
import { resolveCountryCode } from '../shared/geo/countryCode';
import type { SettingsDataJson } from './settings/types';
import logger from '../utils/logger';
import { localWallClockOf, type FlightTimeSemantics } from '../utils/timezone';
import { measuredDurationMinutes } from '../utils/flightDurationColumn';
import {
  addFlightDuration,
  averageDurationMinutes,
  emptyDurationTotals,
  resolveFlightDuration,
} from '../shared/flightDuration';
import { isoCountryCode } from '../utils/continents';
import { buildPassport } from '../services/stats/passport';
import { buildCountryDetail } from '../services/stats/countryDetail';
import { buildWrapped } from '../services/stats/wrapped';
import { buildTravelRecords } from '../services/stats/records';
import { enrichFlightsWithAirportFacts } from '../services/flightAirportFacts';
import { countableFlightWhere } from '../shared/flightCounting';
import {
  normalizeAirline,
  mergeAirlineCounts,
  resolveAirlineCodes,
} from '../utils/airlineNormalize';
import {
  resolveWindow,
  bucketSeries,
  sumTotals,
  trimZeroEdges,
  withinWindow,
  type DatedRow,
} from '../utils/stats/timeseries';
import { computeDedupedTotalCost } from '../utils/stats/dedupedCost';
import { buildTravelAccount } from '../services/stats/travelAccount';
import { buildTripAccount } from '../services/stats/tripAccount';
import { getBaseCurrency } from '../services/fx/snapshot';

const router = Router();

// Authenticated per-user DB aggregations — a single stats page load fans
// out to 5–10 endpoints (overview, airlines, countries, cruise, etc.), so a
// per-user rate limit punishes the legitimate user more than it prevents
// abuse. Same reasoning we applied to /settings. Auth alone is enough here.
router.use(authenticate);

// Shared schema for date-range query parameters
const DateRangeQuerySchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

// Extended schema for summary endpoint with year comparison support
const SummaryQuerySchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  compareYear: z.coerce.number().int().min(1900).max(2100).optional(),
});

/**
 * The country a detail page is asked for. Accepts an ISO alpha-2 code or an
 * English country name — `isoCountryCode` resolves both, and rejecting a name
 * here would make the endpoint stricter than the catalogue that feeds it. The
 * bound is the longest country name the table carries, with room to spare.
 */
const CountryCodeParamSchema = z.object({
  code: z.string().trim().min(2).max(64),
});

// Wrapped — a year in review. Omitting `year` asks for the latest year that
// has anything in it; see services/stats/wrapped.ts rule 1.
const WrappedQuerySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100).optional(),
});

// Timeseries endpoint — bucketed series + current/previous window totals
const TimeseriesQuerySchema = z.object({
  domain: z.enum(['flight', 'cruise']).default('flight'),
  granularity: z.enum(['month', 'year']).default('month'),
  window: z.enum(['rolling12m', 'year', 'all']).default('rolling12m'),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

interface SummaryStats {
  totalFlights: number;
  /** Booked but not yet flown — reported beside the total, never inside it. */
  plannedFlights: number;
  totalDistance: number;
  /**
   * Minutes in the air: measured where the row carries times, estimated from
   * the airport coordinates where it does not (#268). Used to be measured-only,
   * which reported 0 for every DATE_ONLY row while the overview card — showing
   * the SAME label on the SAME screen — estimated them.
   */
  totalFlightTime: number;
  /** The measured part of `totalFlightTime`. */
  flightTimeMeasured: number;
  /** The estimated part. Shown so a total can say how much of it is guessed. */
  flightTimeEstimated: number;
  /** How many flights contributed an estimate rather than a measurement. */
  flightTimeEstimatedCount: number;
  /**
   * Average minutes per flight that CONTRIBUTED a duration — not per flight.
   * Dividing by every flight is what made the overview's average too low.
   * Null when nothing contributed, so the caller renders a dash, not a zero.
   */
  avgFlightTime: number | null;
  avgDistance: number;
  byStatus: Record<string, number>;
  byAirline: Record<string, number>;
  /**
   * Total in `totalCostCurrency`. Contains ONLY amounts that carry an FX
   * snapshot in that currency (#267) — this used to add every price together
   * regardless of currency and was then rendered with the user's display
   * symbol, so 300 USD + 300 EUR read as "600 €".
   */
  totalCost: number;
  totalCostCurrency: string;
  /**
   * What could not be converted, in the currency it was paid in. Reported
   * BESIDE the total, never folded into it. Lodging reports the same way.
   */
  totalCostUnconverted: Record<string, number>;
  byCategory: Record<string, number>;
}

function buildWhere(
  userId: string,
  fromDate: string | undefined,
  toDate: string | undefined,
  filterYear?: number,
): Prisma.FlightWhereInput {
  const where: Prisma.FlightWhereInput = { userId };

  if (filterYear !== undefined) {
    where.departureTime = {
      gte: new Date(Date.UTC(filterYear, 0, 1)),
      lt: new Date(Date.UTC(filterYear + 1, 0, 1)),
    };
  } else if (fromDate || toDate) {
    where.departureTime = {};
    if (fromDate) {
      (where.departureTime as Prisma.DateTimeFilter).gte = new Date(fromDate);
    }
    if (toDate) {
      (where.departureTime as Prisma.DateTimeFilter).lte = new Date(toDate);
    }
  }

  return where;
}

async function computeSummary(
  where: Prisma.FlightWhereInput,
  baseCurrency: string,
): Promise<SummaryStats> {
  // EVERY headline figure describes the same population: flights that actually
  // happened. `totalFlights` and `totalCost` used to run on the unfiltered
  // `where`, so the year card put "14 flights" next to a distance covering ten
  // of them, and /hero answered "1 flight, 0 km, 0 airports" for an account
  // holding a single BOOKED flight.
  //
  // The old design justified that by a `byStatus` breakdown shown next to the
  // number — but its only renderer is imported nowhere, and /hero never
  // carried it. The context was gone; the bare number stayed.
  //
  // `byStatus`/`byAirline`/`byCategory` still run on the unfiltered `where`:
  // a breakdown BY status that hid statuses would be pointless. What is merely
  // booked is reported as `plannedFlights` instead of being folded in.
  const geoWhere: Prisma.FlightWhereInput = { ...where, ...countableFlightWhere() };

  const [
    flownFlights,
    totalFlights,
    plannedFlights,
    statusCounts,
    airlineCounts,
    categoryCounts,
    costFlights,
  ] = await Promise.all([
    prisma.flight.findMany({
      where: geoWhere,
      select: {
        depIata: true,
        depIcao: true,
        depLat: true,
        depLon: true,
        arrIata: true,
        arrIcao: true,
        arrLat: true,
        arrLon: true,
        departureTime: true,
        arrivalTime: true,
        depTimeSemantics: true,
        arrTimeSemantics: true,
        // The stored measurement (forgejo#45). The semantics columns above
        // stay selected because they decide whether it can be trusted.
        durationMinutes: true,
        status: true,
      },
    }),
    prisma.flight.count({ where: geoWhere }),
    prisma.flight.count({ where: { ...where, status: 'scheduled' } }),
    prisma.flight.groupBy({
      by: ['status'],
      where,
      _count: true,
    }),
    prisma.flight.groupBy({
      by: ['airline'],
      where,
      _count: true,
    }),
    prisma.flight.groupBy({
      by: ['category'],
      where,
      _count: true,
    }),
    prisma.flight.findMany({
      // Same population as the count above: a cost total that included flights
      // still to come could not be read next to "flights" or "distance".
      where: geoWhere,
      select: {
        price: true,
        taxes: true,
        fees: true,
        currency: true,
        priceBase: true,
        fxBaseCurrency: true,
        bookingId: true,
        booking: {
          select: { price: true, currency: true, priceBase: true, fxBaseCurrency: true },
        },
      },
    }),
  ]);

  let totalDistance = 0;
  let distanceFlightCount = 0;
  let durationTotals = emptyDurationTotals();

  // Build timezone map for all airports referenced in flown flights
  const allCodes = new Set<string>();
  for (const f of flownFlights) {
    if (f.depIata) allCodes.add(f.depIata);
    if (f.depIcao) allCodes.add(f.depIcao);
    if (f.arrIata) allCodes.add(f.arrIata);
    if (f.arrIcao) allCodes.add(f.arrIcao);
  }
  let tzMap = new Map<string, string>();
  try {
    const airports = await getCachedAirports(Array.from(allCodes));
    for (const [code, data] of airports.entries()) {
      if (data?.timezone) tzMap.set(code, data.timezone);
    }
  } catch {
    // timezone lookup failed — durations will use naïve diff
  }

  flownFlights.forEach(flight => {
    const distance = calculateDistance(
      flight.depLat,
      flight.depLon,
      flight.arrLat,
      flight.arrLon
    );
    totalDistance += distance;
    if (distance > 0) distanceFlightCount += 1;

    const depTz = (flight.depIata && tzMap.get(flight.depIata))
      || (flight.depIcao && tzMap.get(flight.depIcao))
      || null;
    const arrTz = (flight.arrIata && tzMap.get(flight.arrIata))
      || (flight.arrIcao && tzMap.get(flight.arrIcao))
      || null;
    // A `historical` row's clocks are placeholders, not evidence — see
    // `businessStats.ts` for the same guard and the reason. It contributes a
    // coordinate estimate below instead.
    const flightTime = flight.status === 'flown'
      ? measuredDurationMinutes(flight, depTz, arrTz)
      : null;
    // #106A still holds: a DATE_ONLY row must never contribute its placeholder
    // times, so `flightTime` stays null for it and no fiction is measured. What
    // changed in #268 is what happens NEXT — instead of silently adding 0, the
    // row contributes a coordinate-derived estimate that is counted separately
    // and labelled as such. A guess the reader can see beats a zero they cannot.
    durationTotals = addFlightDuration(durationTotals, {
      measuredMinutes: flightTime,
      depLat: flight.depLat,
      depLon: flight.depLon,
      arrLat: flight.arrLat,
      arrLon: flight.arrLon,
    });
  });

  // Divided by flights that HAVE a distance. A row without coordinates
  // contributes no kilometres, so counting it in the denominator only drags the
  // average down — the client already divided this way, the server did not.
  const avgDistance = distanceFlightCount > 0 ? totalDistance / distanceFlightCount : 0;

  const byStatus = statusCounts.reduce((acc, item) => {
    acc[item.status] = item._count;
    return acc;
  }, {} as Record<string, number>);

  const rawByAirline = airlineCounts.reduce((acc, item) => {
    const airline = item.airline || 'Unknown';
    acc[airline] = item._count;
    return acc;
  }, {} as Record<string, number>);
  const byAirline = mergeAirlineCounts(rawByAirline);

  const byCategory = categoryCounts.reduce((acc, item) => {
    const cat = item.category || 'unassigned';
    acc[cat] = item._count;
    return acc;
  }, {} as Record<string, number>);

  // Booking-aware: a booking's price counts once, not once per segment —
  // and grouped segments (price nulled by the import) still contribute
  // their booking's total (spec 2026-07-17-cost-booking-price §4).
  const cost = computeDedupedTotalCost(costFlights, baseCurrency);

  return {
    totalFlights,
    plannedFlights,
    totalDistance: Math.round(totalDistance),
    totalFlightTime: Math.round(durationTotals.totalMinutes),
    flightTimeMeasured: Math.round(durationTotals.measuredMinutes),
    flightTimeEstimated: Math.round(durationTotals.estimatedMinutes),
    flightTimeEstimatedCount: durationTotals.estimatedCount,
    avgFlightTime: (() => {
      const avg = averageDurationMinutes(durationTotals);
      return avg === null ? null : Math.round(avg);
    })(),
    avgDistance: Math.round(avgDistance),
    byStatus,
    byAirline,
    totalCost: cost.base,
    totalCostCurrency: baseCurrency,
    totalCostUnconverted: cost.unconvertedByCurrency,
    byCategory,
  };
}

// Schema for routes query parameters
const RoutesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

// Get summary statistics
router.get('/summary', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const parsed = SummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
      return;
    }
    const { fromDate, toDate, year, compareYear } = parsed.data;
    const baseCurrency = await getBaseCurrency(userId);

    if (year !== undefined && compareYear !== undefined) {
      // Return comparison response: { current, compare }
      const [current, compare] = await Promise.all([
        computeSummary(buildWhere(userId, fromDate, toDate, year), baseCurrency),
        computeSummary(buildWhere(userId, fromDate, toDate, compareYear), baseCurrency),
      ]);
      res.json({ current, compare });
    } else {
      // Return flat summary (backward-compatible)
      const summary = await computeSummary(buildWhere(userId, fromDate, toDate, year), baseCurrency);
      res.json(summary);
    }
  } catch (error) {
    next(error);
  }
});

interface HeroStats {
  distanceKm: number;
  flights: number;
  countries: number;
  airports: number;
  co2Kg: number;
  flightTimeMinutes: number;
}

// GET /api/v1/stats/hero — single composed aggregate for the Companion app's
// Start-board hero widget. Reuses the SAME functions that back /summary,
// /airports and /fun (computeSummary, calculateAirportStats, calculateFunStats)
// instead of duplicating their queries. All-time only for the MVP — no
// date-range params yet. The airport+fun flight select is fetched ONCE and
// shared between calculateAirportStats and calculateFunStats since both use
// the identical select already used by /airports and /fun.
router.get('/hero', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const flightsWhere: Prisma.FlightWhereInput = {
      userId,
      ...countableFlightWhere(),
    };
    const baseCurrency = await getBaseCurrency(userId);

    const [summary, flights] = await Promise.all([
      computeSummary(buildWhere(userId, undefined, undefined), baseCurrency),
      prisma.flight.findMany({
        where: flightsWhere,
        select: {
          id: true,
          depLat: true,
          depLon: true,
          arrLat: true,
          arrLon: true,
          depIata: true,
          depIcao: true,
          arrIata: true,
          arrIcao: true,
          airline: true,
          aircraft: true,
          departureTime: true,
          arrivalTime: true,
          depTimeSemantics: true,
          status: true,
          price: true,
          taxes: true,
          fees: true,
          category: true,
          seatClass: true,
          createdAt: true,
        },
      }),
    ]);
    const datedFlights = await withDepartureClock(flights);

    // homeAirportHistory=[] is deliberate: this endpoint only reads
    // countryCount/airportCount, which don't depend on home-airport history —
    // only the unused farthestFromHome field does. Skips /airports's extra
    // userSettings.findUnique lookup.
    const [airportStats, funStats] = await Promise.all([
      calculateAirportStats(datedFlights, []),
      calculateFunStats(datedFlights),
    ]);

    const hero: HeroStats = {
      distanceKm: summary.totalDistance,
      flights: summary.totalFlights,
      countries: airportStats.countryCount,
      airports: airportStats.airportCount,
      co2Kg: funStats.co2FootprintKg,
      flightTimeMinutes: summary.totalFlightTime,
    };

    res.json(hero);
  } catch (error) {
    next(error);
  }
});

// Build a UTC-timezone map for a set of flight rows (mirrors computeSummary).
async function buildTzMap(
  rows: Array<{ depIata: string | null; depIcao: string | null; arrIata: string | null; arrIcao: string | null }>,
): Promise<Map<string, string>> {
  const codes = new Set<string>();
  for (const f of rows) {
    if (f.depIata) codes.add(f.depIata);
    if (f.depIcao) codes.add(f.depIcao);
    if (f.arrIata) codes.add(f.arrIata);
    if (f.arrIcao) codes.add(f.arrIcao);
  }
  const map = new Map<string, string>();
  try {
    const airports = await getCachedAirports(Array.from(codes));
    for (const [code, data] of airports.entries()) {
      if (data?.timezone) map.set(code, data.timezone);
    }
  } catch {
    // timezone lookup failed — durations fall back to naïve diff
  }
  return map;
}

/**
 * Attach the departure airport's timezone to each row.
 *
 * The flight table stores instants; the clock a departure happened on lives on
 * the airport. Every "when did I fly" figure — time of day, weekday, month,
 * which calendar day or year a flight belongs to — has to be read on that
 * clock, so it travels with the row into the stats modules (#266) rather than
 * each of them resolving it, or forgetting to.
 */
async function withDepartureClock<
  T extends {
    depIata: string | null;
    depIcao: string | null;
    arrIata: string | null;
    arrIcao: string | null;
    depTimeSemantics: string;
  },
>(rows: T[]): Promise<Array<T & { depTimezone: string | null; depTimeSemantics: FlightTimeSemantics }>> {
  const tzMap = await buildTzMap(rows);
  return rows.map((f) => ({
    ...f,
    depTimezone:
      (f.depIata ? tzMap.get(f.depIata) : undefined) ??
      (f.depIcao ? tzMap.get(f.depIcao) : undefined) ??
      null,
    depTimeSemantics: f.depTimeSemantics as FlightTimeSemantics,
  }));
}

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

async function fetchFlightDatedRows(
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
      f.status === 'flown' ? measuredDurationMinutes(f, depTz, arrTz) : null;
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

async function fetchCruiseDatedRows(
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

// GET /api/v1/stats/timeseries — bucketed series (month|year) + current/previous
// window totals, domain-parameterized (flight|cruise). Powers the Wave A
// stats redesign's trend charts.
router.get('/timeseries', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const parsed = TimeseriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
      return;
    }
    const { domain, granularity, window, year, fromDate, toDate } = parsed.data;
    const w = resolveWindow(window, year, fromDate, toDate, new Date());

    const fetchRows = domain === 'cruise' ? fetchCruiseDatedRows : fetchFlightDatedRows;
    const [fetchedCurrent, fetchedPrevious] = await Promise.all([
      fetchRows(userId, w.from, w.to),
      w.prevFrom && w.prevTo ? fetchRows(userId, w.prevFrom, w.prevTo) : Promise.resolve([] as DatedRow[]),
    ]);

    // The flight fetcher deliberately over-fetches by a day at each edge, so
    // the window is decided HERE, once, on the local calendar day — and the
    // series and the totals below cannot disagree about what was in it.
    const currentRows = withinWindow(fetchedCurrent, w.from, w.to);
    const previousRows =
      w.prevFrom && w.prevTo ? withinWindow(fetchedPrevious, w.prevFrom, w.prevTo) : [];

    const rawSeries = bucketSeries(currentRows, granularity, w.from, w.to);
    // The all-time window spans from the Unix epoch, so trim the leading/
    // trailing empty buckets down to the user's actual data range. Bounded
    // windows (rolling12m, year, explicit range) keep their zero buckets —
    // those empty periods are meaningful context.
    const series =
      window === 'all' && !fromDate && !toDate ? trimZeroEdges(rawSeries) : rawSeries;

    res.json({
      domain,
      granularity,
      window: { from: w.from.toISOString(), to: w.to.toISOString() },
      series,
      current: sumTotals(currentRows),
      previous: sumTotals(previousRows),
    });
  } catch (error) {
    next(error);
  }
});

// Get top routes
router.get('/routes', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const parsed = RoutesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
      return;
    }
    const limit = parsed.data.limit ?? 10;

    // Routes are time-insensitive (airport-pair grouping + great-circle distance),
    // so historical flights are included.
    const flights = await prisma.flight.findMany({
      where: { userId, ...countableFlightWhere() },
      select: {
        depIata: true,
        depIcao: true,
        depName: true,
        depLat: true,
        depLon: true,
        arrIata: true,
        arrIcao: true,
        arrName: true,
        arrLat: true,
        arrLon: true,
      },
    });

    /**
     * Grouped by the PAIR, not the direction — Forgejo #42, owner's decision
     * 2026-08-31.
     *
     * This used to key `${dep}-${arr}`, so FRA→WAW and WAW→FRA were two routes
     * with one flight each while the Companion's globe grouped them as one with
     * two. Same account, two different route counts, and neither side was
     * wrong on its own terms — which is exactly the drift #42 was filed about.
     *
     * A person says "I have flown Munich–Dubai eleven times" and means both
     * directions. So the pair is the route, and the key is the two codes
     * sorted: FRA-WAW and WAW-FRA both become "FRA-WAW".
     *
     * This CHANGES the top-routes list for existing accounts — two entries of
     * one collapse into one of two, which reorders the ranking. That is a
     * visible change and belongs in the changelog, not a silent fix.
     *
     * `departure`/`arrival` name the first flight of the pair that was seen.
     * With direction no longer meaningful they are simply the two ends; the
     * distance is the same either way.
     */
    const routeMap = new Map<string, {
      count: number;
      departure: { iata?: string; name?: string; lat: number; lon: number };
      arrival: { iata?: string; name?: string; lat: number; lon: number };
      distance: number;
    }>();

    flights.forEach(flight => {
      const depCode = flight.depIata || flight.depIcao;
      const arrCode = flight.arrIata || flight.arrIcao;
      // Sorted, so both directions land on one key. `String()` guards the
      // null-code case, which would otherwise sort inconsistently.
      const routeKey = [String(depCode), String(arrCode)].sort().join('-');

      if (routeMap.has(routeKey)) {
        routeMap.get(routeKey)!.count++;
      } else {
        routeMap.set(routeKey, {
          count: 1,
          departure: {
            iata: flight.depIata || undefined,
            name: flight.depName || undefined,
            lat: flight.depLat,
            lon: flight.depLon,
          },
          arrival: {
            iata: flight.arrIata || undefined,
            name: flight.arrName || undefined,
            lat: flight.arrLat,
            lon: flight.arrLon,
          },
          distance: calculateDistance(
            flight.depLat,
            flight.depLon,
            flight.arrLat,
            flight.arrLon
          ),
        });
      }
    });

    // Convert to array and sort by count
    const routes = Array.from(routeMap.entries())
      .map(([route, data]) => ({
        route,
        ...data,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    res.json({ routes });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/stats/network — the WHOLE network: every drawable airport with
// its visit count, every flown airport pair with its count and distance.
//
// DELIBERATELY UNBOUNDED. Do NOT add a `limit` here "for symmetry" with
// /routes: a globe drawn from a truncated network is not a smaller globe, it is
// a WRONG one — arcs the traveller flew are simply missing and nothing on
// screen says so. Truncating is a decision only a ranked LIST can afford, which
// is why /routes may and this may not. If the payload ever becomes a problem,
// the answer is compression or a conditional GET, not a shorter truth.
//
// Routes are the unordered PAIR (FRA-WAW and WAW-FRA are one route, count 2)
// and airports carry coordinates — the two things that make this drawable and
// that /routes and /airports do not both offer. See services/stats/network.ts
// for the four rules and for why an airport without usable coordinates is
// omitted rather than returned with nulls.
router.get('/network', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    // Same done-predicate as every other aggregate in this file. A booked
    // flight is not a line on a map.
    const flights = await prisma.flight.findMany({
      where: { userId, ...countableFlightWhere() },
      select: {
        depIata: true,
        depIcao: true,
        depLat: true,
        depLon: true,
        arrIata: true,
        arrIcao: true,
        arrLat: true,
        arrLon: true,
        status: true,
      },
    });

    const codes = new Set<string>();
    for (const f of flights) {
      const dep = f.depIata ?? f.depIcao;
      const arr = f.arrIata ?? f.arrIcao;
      if (dep) codes.add(dep);
      if (arr) codes.add(arr);
    }

    // The catalogue folds ICAO-only rows onto their IATA node and supplies
    // coordinates for rows that never got any. A failed lookup is not fatal —
    // the derivation then works from the flight rows alone, which is what it
    // did before the catalogue was consulted at all.
    let catalogue = new Map<string, AirportData>();
    try {
      catalogue = await getCachedAirports([...codes]);
    } catch (error) {
      logger.error({
        operation: 'stats_network_airport_lookup_failed',
        message: 'Airport catalogue unavailable, building network from flight rows only',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    res.json(buildFlightNetwork(flights, catalogue));
  } catch (error) {
    next(error);
  }
});

// Get fun/entertaining statistics
router.get('/fun', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const parsed = DateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
      return;
    }
    const { fromDate, toDate } = parsed.data;

    // Fun stats are computed across both flown and historical flights; the
    // helper applies a tighter `flown`-only filter for time-sensitive parts
    // (time-of-day buckets, weekend warrior).
    const where: Prisma.FlightWhereInput = { userId, ...countableFlightWhere() };

    if (fromDate || toDate) {
      where.departureTime = {};
      if (fromDate) {
        where.departureTime.gte = new Date(fromDate);
      }
      if (toDate) {
        where.departureTime.lte = new Date(toDate);
      }
    }

    const flights = await prisma.flight.findMany({
      where,
      select: {
        id: true,
        depLat: true,
        depLon: true,
        arrLat: true,
        arrLon: true,
        depIata: true,
        depIcao: true,
        arrIata: true,
        arrIcao: true,
        airline: true,
        aircraft: true,
        departureTime: true,
        arrivalTime: true,
        depTimeSemantics: true,
        status: true,
        price: true,
        taxes: true,
        fees: true,
        category: true,
        seatClass: true,
        createdAt: true,
      },
    });

    // Calculate stats with error handling - continue even if airport data fails
    let funStats;
    try {
      funStats = await calculateFunStats(await withDepartureClock(flights));
    } catch (statsError) {
      // If stats calculation fails (e.g., database issues), return partial stats
      // This prevents the entire endpoint from failing
      logger.error({
        operation: 'calculate_fun_stats_error',
        message: 'Failed to calculate fun stats, returning partial data',
        error: statsError instanceof Error ? statsError.message : 'Unknown error',
      });
      // Return a minimal response instead of failing completely
      funStats = {
        timezoneHopper: 0,
        earlyBird: 0,
        afternoon: 0,
        nightOwl: 0,
        weekendWarrior: 0,
        weekendPercentage: 0,
        loyaltyScore: 0,
        mostUsedAirline: null,
        shortHaulKing: 0,
        longHaulPilot: 0,
        fastestDay: null,
        fastestDayFlights: 0,
        co2FootprintKg: 0,
        co2InElephants: 0,
        milestoneYear: null,
        milestoneYearFlights: 0,
        routeMaster: null,
        routeMasterCount: 0,
      };
    }

    res.json(funStats);
  } catch (error) {
    next(error);
  }
});

// Get business/informative statistics
router.get('/business', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const parsed = DateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
      return;
    }
    const { fromDate, toDate } = parsed.data;

    // Business stats are computed across both flown and historical flights; the
    // helper applies a tighter `flown`-only filter for duration-based metrics
    // (avgFlightDuration, costPerHour).
    const where: Prisma.FlightWhereInput = { userId, ...countableFlightWhere() };

    if (fromDate || toDate) {
      where.departureTime = {};
      if (fromDate) {
        where.departureTime.gte = new Date(fromDate);
      }
      if (toDate) {
        where.departureTime.lte = new Date(toDate);
      }
    }

    const flights = await prisma.flight.findMany({
      where,
      select: {
        id: true,
        depLat: true,
        depLon: true,
        arrLat: true,
        arrLon: true,
        depIata: true,
        depIcao: true,
        arrIata: true,
        arrIcao: true,
        airline: true,
        aircraft: true,
        departureTime: true,
        arrivalTime: true,
        depTimeSemantics: true,
        status: true,
        price: true,
        taxes: true,
        fees: true,
        currency: true,
        priceBase: true,
        fxBaseCurrency: true,
        category: true,
        seatClass: true,
        createdAt: true,
        bookingId: true,
        booking: {
          select: {
            id: true,
            price: true,
            currency: true,
            priceBase: true,
            fxBaseCurrency: true,
          },
        },
      },
    });

    // Business stats don't require database lookups, so they should be safe
    // But wrap in try-catch for safety
    let businessStats;
    try {
      businessStats = calculateBusinessStats(
        await withDepartureClock(flights),
        await getBaseCurrency(userId),
      );
    } catch (statsError) {
      logger.error({
        operation: 'calculate_business_stats_error',
        message: 'Failed to calculate business stats',
        error: statsError instanceof Error ? statsError.message : 'Unknown error',
      });
      // Return minimal response
      businessStats = {
        costPerKm: 0,
        costPerHour: 0,
        totalCost: 0,
        totalDistance: 0,
        seatClassDistribution: {},
        mostCommonCategory: null,
        airportDiversity: 0,
        avgFlightDuration: 0,
        busiestMonth: null,
        busiestMonthFlights: 0,
        categoryDistribution: {},
      };
    }

    res.json(businessStats);
  } catch (error) {
    next(error);
  }
});

// Get unique/special statistics
router.get('/unique', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const parsed = DateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
      return;
    }
    const { fromDate, toDate } = parsed.data;

    // Unique stats are computed across both flown and historical flights; the
    // helper applies a tighter `flown`-only filter for time-sensitive parts
    // (time-travel index, layovers, fastest route, midnight crossings, etc.).
    const where: Prisma.FlightWhereInput = { userId, ...countableFlightWhere() };

    if (fromDate || toDate) {
      where.departureTime = {};
      if (fromDate) {
        where.departureTime.gte = new Date(fromDate);
      }
      if (toDate) {
        where.departureTime.lte = new Date(toDate);
      }
    }

    const flights = await prisma.flight.findMany({
      where,
      select: {
        id: true,
        depLat: true,
        depLon: true,
        arrLat: true,
        arrLon: true,
        depIata: true,
        depIcao: true,
        arrIata: true,
        arrIcao: true,
        airline: true,
        aircraft: true,
        departureTime: true,
        arrivalTime: true,
        depTimeSemantics: true,
        status: true,
        price: true,
        taxes: true,
        fees: true,
        category: true,
        seatClass: true,
        createdAt: true,
      },
    });

    // Load home airport history so layovers exclude returns to home-at-that-date.
    const homeSettings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { data: true },
    });
    const historyData =
      homeSettings?.data && typeof homeSettings.data === 'object'
        ? (homeSettings.data as SettingsDataJson).homeAirportHistory
        : undefined;
    const homeHistory = normalizeHistory(historyData);

    // Calculate unique stats with error handling - continue even if airport data fails
    let uniqueStats;
    try {
      uniqueStats = await calculateUniqueStats(await withDepartureClock(flights), homeHistory);
    } catch (statsError) {
      // If stats calculation fails (e.g., database issues), return partial stats
      logger.error({
        operation: 'calculate_unique_stats_error',
        message: 'Failed to calculate unique stats, returning partial data',
        error: statsError instanceof Error ? statsError.message : 'Unknown error',
      });
      // Return a minimal response instead of failing completely
      uniqueStats = {
        timeTravelIndex: 0,
        equatorCrossings: 0,
        arcticFlights: 0,
        oceanCrossings: 0,
        highestAirport: null,
        northernmost: null,
        southernmost: null,
        longestTravelChain: 0,
        fastestRoute: null,
        mostCountriesInDay: 0,
        mostCountriesDate: null,
        hemisphereHops: 0,
        dateLineCrossings: 0,
        continentalExplorer: 0,
        continents: [],
        tropicsTraveler: 0,
        eastWestBalance: { eastward: 0, westward: 0, ratio: 0 },
        sameDayReturns: 0,
        midnightFlights: 0,
        seasonalExplorer: false,
        seasonsCount: 0,
        internationalVsDomestic: { international: 0, domestic: 0, ratio: 0 },
        longestLayover: null,
        shortestLayover: null,
        roundTripMaster: 0,
      };
    }

    res.json(uniqueStats);
  } catch (error) {
    next(error);
  }
});

// Airport-focused statistics (top airports, rarest, farthest from home, etc.)
router.get(
  '/airports',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;

      const parsed = DateRangeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
        return;
      }
      const { fromDate, toDate } = parsed.data;

      // Airport stats are time-insensitive (counts, country/continent, distance),
      // so historical flights are included.
      const where: Prisma.FlightWhereInput = { userId, ...countableFlightWhere() };
      if (fromDate || toDate) {
        where.departureTime = {};
        if (fromDate) where.departureTime.gte = new Date(fromDate);
        if (toDate) where.departureTime.lte = new Date(toDate);
      }

      const flights = await prisma.flight.findMany({
        where,
        select: {
          id: true,
          depLat: true,
          depLon: true,
          arrLat: true,
          arrLon: true,
          depIata: true,
          depIcao: true,
          arrIata: true,
          arrIcao: true,
          airline: true,
          aircraft: true,
          departureTime: true,
          arrivalTime: true,
          depTimeSemantics: true,
          status: true,
          price: true,
          taxes: true,
          fees: true,
          category: true,
          seatClass: true,
          createdAt: true,
        },
      });

      const homeSettings = await prisma.userSettings.findUnique({
        where: { userId },
        select: { data: true },
      });
      const historyData =
        homeSettings?.data && typeof homeSettings.data === 'object'
          ? (homeSettings.data as SettingsDataJson).homeAirportHistory
          : undefined;
      const homeHistory = normalizeHistory(historyData);

      const stats = await calculateAirportStats(await withDepartureClock(flights), homeHistory);
      res.json(stats);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * The passport — countries, their airports, and a continent quota.
 *
 * One endpoint rather than two raw ones the clients re-aggregate: the Companion
 * app already derives this screen client-side, and a second derivation in the
 * web frontend would be a third copy of arithmetic that has to agree. The
 * rules, and why each was chosen to match a figure published elsewhere on this
 * server, are in services/stats/passport.ts.
 */
/**
 * GET /stats/records — the seven travel records, derived here (Forgejo #41).
 *
 * The Companion computes these client-side today, from the raw flight list.
 * That is one implementation of "what was my longest flight" living in one
 * client, and #42 is the audit of what that costs: a second implementation in
 * the web app would answer the same question differently the first time an edge
 * case came up. The rules — and the abstentions, which are the interesting part
 * — are in services/stats/records.ts, ported from the Companion's tested
 * adapter rather than rewritten.
 *
 * Numbers, not sentences: a formatted "12.345 km" in a JSON body would fix the
 * decimal separator and the unit for every client that ever reads it.
 */
router.get(
  '/records',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;

      const flights = await prisma.flight.findMany({
        where: { userId, ...countableFlightWhere() },
        select: {
          id: true,
          flightNumber: true,
          depIata: true,
          depIcao: true,
          arrIata: true,
          arrIcao: true,
          depLat: true,
          depLon: true,
          arrLat: true,
          arrLon: true,
          departureTime: true,
          arrivalTime: true,
          depTimeSemantics: true,
          arrTimeSemantics: true,
          delayMinutes: true,
          routeDistance: true,
          status: true,
        },
      });

      // `durationMinutes` is not a column — it is derived from the two clocks,
      // their timezones and their semantics. Deriving it a second time here
      // would be the very drift #42 is about, so the record uses the SAME
      // enrichment every other flight response goes through: a DATE_ONLY row
      // comes back with a null duration and the aloft record abstains, exactly
      // as it does in the app.
      const enriched = await enrichFlightsWithAirportFacts(flights);

      res.json({ success: true, data: { records: buildTravelRecords(enriched) } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The airport codes a passport-shaped flight row touches, deduplicated.
 *
 * IATA only, deliberately: `buildPassport` keys its airports by that code and
 * an ICAO fallback would file the same airport twice under two names.
 */
function passportAirportCodes(
  flights: readonly { depIata: string | null; arrIata: string | null }[],
): string[] {
  return [
    ...new Set(
      flights.flatMap((f) => [f.depIata, f.arrIata]).filter((c): c is string => Boolean(c)),
    ),
  ];
}

/** Country per airport code, as the catalogue holds it. */
async function loadAirportCountries(codes: string[]): Promise<Map<string, string | null>> {
  // One catalogue lookup for every end of every flight. A failure here costs
  // the countries, so it is reported rather than swallowed into an empty
  // passport that looks like someone who has never flown.
  const airports = codes.length > 0 ? await getCachedAirports(codes) : new Map();
  return new Map<string, string | null>(
    [...airports.entries()].map(([code, data]) => [code, data?.country ?? null]),
  );
}

/** The user's home airport codes, newest history first. */
async function loadHomeIatas(userId: string): Promise<string[]> {
  const homeSettings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { data: true },
  });
  const historyData =
    homeSettings?.data && typeof homeSettings.data === 'object'
      ? (homeSettings.data as SettingsDataJson).homeAirportHistory
      : undefined;
  return normalizeHistory(historyData).map((entry) => entry.iata);
}

/**
 * Build the whole passport for a user.
 *
 * Extracted so `/stats/wrapped` can take its "new countries this year" from
 * the same object `/stats/passport` publishes. Deriving that number a second
 * time from the flight list would make the story disagree with the passport on
 * an account with a cruise — which is precisely the drift #42 is about.
 */
async function loadPassport(userId: string): Promise<ReturnType<typeof buildPassport>> {
  const flights = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
    select: {
      depIata: true,
      depLat: true,
      depLon: true,
      arrIata: true,
      arrLat: true,
      arrLon: true,
      departureTime: true,
      status: true,
    },
  });

  /**
   * Evidence beyond landings — Forgejo #42, owner's decision 2026-08-31.
   *
   * A cruise that CALLED at a port and a place the user recorded visiting
   * both prove presence. Only sailed cruises count, the same cut rule 1
   * makes for flights, and a place joins on its resolved `isoCountryCode`
   * because "Deutschland" and "Germany" are one country and only the code
   * knows that.
   *
   * Fetched here rather than inside the service so the derivation stays a
   * pure function of its inputs and keeps its unit tests.
   */
  const [airportCountries, portCalls, placeVisits, homeIatas] = await Promise.all([
    loadAirportCountries(passportAirportCodes(flights)),
    prisma.cruiseStop.findMany({
      where: {
        cruise: { userId, status: { in: ['flown', 'historical'] } },
        port: { isNot: null },
      },
      select: { arrivalTime: true, date: true, port: { select: { country: true } } },
    }),
    prisma.place.findMany({
      where: { userId, visited: true, isoCountryCode: { not: null } },
      select: { isoCountryCode: true, visits: { select: { visitedAt: true } } },
    }),
    loadHomeIatas(userId),
  ]);

  return buildPassport(
    flights,
    airportCountries,
    homeIatas,
    new Date(),
    portCalls.map((stop) => ({
      country: stop.port?.country ?? null,
      at: stop.arrivalTime ?? stop.date,
    })),
    // A place's visits, flattened: each dated visit is its own evidence,
    // and a place with none still proves the country through `visited`.
    placeVisits.flatMap((place) =>
      place.visits.length > 0
        ? place.visits.map((v) => ({
            isoCountryCode: place.isoCountryCode,
            at: v.visitedAt,
          }))
        : [{ isoCountryCode: place.isoCountryCode, at: null }],
    ),
  );
}

router.get(
  '/passport',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await loadPassport(req.userId!));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /stats/countries/:code — one country, in detail (Forgejo #42).
 *
 * The drill-down behind a passport row. It answers for a country reached only
 * by cruise or by a recorded place too, because the passport lists those rows
 * and a 404 there would put the list and the page into the disagreement #42 is
 * about. The rules are in services/stats/countryDetail.ts.
 *
 * Bare object rather than a `{ success, data }` envelope: it sits beside
 * `/stats/countries` and `/stats/passport`, and a client that walks from a row
 * to its page should not have to unwrap a second shape halfway.
 */
router.get(
  '/countries/:code',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const parsed = CountryCodeParamSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid country', details: parsed.error.errors });
        return;
      }

      const flights = await prisma.flight.findMany({
        where: { userId, ...countableFlightWhere() },
        select: {
          id: true,
          flightNumber: true,
          depIata: true,
          depLat: true,
          depLon: true,
          arrIata: true,
          arrLat: true,
          arrLon: true,
          departureTime: true,
          status: true,
        },
      });

      // The same three sources the passport counts, so the row and the page
      // can only ever agree.
      const [airportCountries, portCalls, places, homeIatas] = await Promise.all([
        loadAirportCountries(passportAirportCodes(flights)),
        prisma.cruiseStop.findMany({
          where: {
            cruise: { userId, status: { in: ['flown', 'historical'] } },
            port: { isNot: null },
          },
          select: {
            cruiseId: true,
            arrivalTime: true,
            date: true,
            port: { select: { name: true, country: true } },
          },
        }),
        prisma.place.findMany({
          where: { userId, visited: true, isoCountryCode: { not: null } },
          select: {
            id: true,
            name: true,
            isoCountryCode: true,
            visits: { select: { visitedAt: true } },
          },
        }),
        loadHomeIatas(userId),
      ]);

      const detail = buildCountryDetail(
        parsed.data.code,
        flights,
        airportCountries,
        homeIatas,
        portCalls.map((stop) => ({
          cruiseId: stop.cruiseId,
          portName: stop.port?.name ?? null,
          country: stop.port?.country ?? null,
          at: stop.arrivalTime ?? stop.date,
        })),
        places.flatMap((place) =>
          place.visits.length > 0
            ? place.visits.map((v) => ({
                placeId: place.id,
                name: place.name,
                isoCountryCode: place.isoCountryCode,
                at: v.visitedAt,
              }))
            : [
                {
                  placeId: place.id,
                  name: place.name,
                  isoCountryCode: place.isoCountryCode,
                  at: null,
                },
              ],
        ),
      );

      if (!detail) {
        // Nothing evidences this country — including a code the catalogue does
        // not know. Both are "you have not been there", and saying so is
        // better than an empty page that looks like a loading failure.
        res.status(404).json({ error: 'No record of this country' });
        return;
      }

      res.json(detail);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /stats/wrapped?year= — the year in review (Forgejo #42, the last piece).
 *
 * Without `year` the story is about the latest year that has anything in it,
 * read off the data and never off the wall clock, so the same account tells the
 * same story on New Year's Eve and the morning after. The rules — and the two
 * deliberate departures from the Companion's version this is ported from — are
 * in services/stats/wrapped.ts.
 */
router.get(
  '/wrapped',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const parsed = WrappedQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
        return;
      }

      const [flights, cruises, passport] = await Promise.all([
        prisma.flight.findMany({
          where: { userId, ...countableFlightWhere() },
          select: {
            depIata: true,
            depLat: true,
            depLon: true,
            arrIata: true,
            arrLat: true,
            arrLon: true,
            departureTime: true,
            airline: true,
            flightNumber: true,
            status: true,
          },
        }),
        prisma.cruise.findMany({
          where: { userId, ...countableFlightWhere() },
          select: { startDate: true, status: true },
        }),
        // For `newCountries` only — the passport already decides what counts as
        // a country and when it was first reached.
        loadPassport(userId),
      ]);

      const wrapped = buildWrapped(
        // Great-circle from the coordinates, the same measure
        // `/stats/timeseries` buckets — so the year's distance agrees with the
        // year's bar on the trend chart.
        flights.map((f) => ({
          ...f,
          distanceKm: calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon),
        })),
        cruises,
        passport.countries,
        parsed.data.year ?? null,
      );

      if (!wrapped) {
        // No countable activity in any year. There is no story, and a grid of
        // zeros would pretend there is one.
        res.status(404).json({ error: 'Nothing to look back on yet' });
        return;
      }

      res.json(wrapped);
    } catch (error) {
      next(error);
    }
  },
);

// Seat position statistics
interface SeatStats {
  windowCount: number;
  middleCount: number;
  aisleCount: number;
  unknownCount: number;
  noSeatCount: number;
  frontCount: number;
  middleZoneCount: number;
  backCount: number;
  mostCommonSeat: string | null;
  seatClassDistribution: Record<string, number>;
  avgRowNumber: number | null;
}

router.get('/seats', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const parsed = DateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
      return;
    }
    const { fromDate, toDate } = parsed.data;

    // Seat statistics are time-insensitive (just position/class buckets),
    // so historical flights with seat data are included.
    const where: Prisma.FlightWhereInput = { userId, ...countableFlightWhere() };

    if (fromDate || toDate) {
      where.departureTime = {};
      if (fromDate) {
        where.departureTime.gte = new Date(fromDate);
      }
      if (toDate) {
        where.departureTime.lte = new Date(toDate);
      }
    }

    const flights = await prisma.flight.findMany({
      where,
      select: {
        seatNumber: true,
        seatClass: true,
      },
    });

    const seatRegex = /^(\d+)([A-Z]+)$/i;
    const seatCounts: Record<string, number> = {};

    let windowCount = 0;
    let middleCount = 0;
    let aisleCount = 0;
    let unknownCount = 0;
    let noSeatCount = 0;
    let frontCount = 0;
    let middleZoneCount = 0;
    let backCount = 0;
    let rowTotal = 0;
    let rowCountWithNumber = 0;
    const seatClassDistribution: Record<string, number> = {};

    for (const flight of flights) {
      // Count seat class distribution
      if (flight.seatClass) {
        seatClassDistribution[flight.seatClass] = (seatClassDistribution[flight.seatClass] ?? 0) + 1;
      }

      if (!flight.seatNumber) {
        noSeatCount++;
        continue;
      }

      // Count seat occurrences for mostCommonSeat
      const normalizedSeat = flight.seatNumber.toUpperCase();
      seatCounts[normalizedSeat] = (seatCounts[normalizedSeat] ?? 0) + 1;

      const match = seatRegex.exec(flight.seatNumber);
      if (!match) {
        unknownCount++;
        continue;
      }

      const rowNumber = parseInt(match[1], 10);
      const letters = match[2].toUpperCase();
      const lastLetter = letters[letters.length - 1];

      // Row zone classification
      rowTotal += rowNumber;
      rowCountWithNumber++;

      if (rowNumber >= 1 && rowNumber <= 10) {
        frontCount++;
      } else if (rowNumber >= 11 && rowNumber <= 25) {
        middleZoneCount++;
      } else {
        backCount++;
      }

      // Position classification by last letter
      // Covers narrow-body (A-F: 3+3) and wide-body (A-K: 3+4+3) layouts:
      //   Window: A, F, K
      //   Middle: B, E, H, J (wide-body center section)
      //   Aisle:  C, D, G (narrow/wide-body aisle seats)
      if (lastLetter === 'A' || lastLetter === 'F' || lastLetter === 'K') {
        windowCount++;
      } else if (lastLetter === 'B' || lastLetter === 'E' || lastLetter === 'H' || lastLetter === 'J') {
        middleCount++;
      } else if (lastLetter === 'C' || lastLetter === 'D' || lastLetter === 'G') {
        aisleCount++;
      } else {
        unknownCount++;
      }
    }

    // Most common seat
    let mostCommonSeat: string | null = null;
    let maxSeatCount = 0;
    for (const [seat, count] of Object.entries(seatCounts)) {
      if (count > maxSeatCount) {
        maxSeatCount = count;
        mostCommonSeat = seat;
      }
    }

    const result: SeatStats = {
      windowCount,
      middleCount,
      aisleCount,
      unknownCount,
      noSeatCount,
      frontCount,
      middleZoneCount,
      backCount,
      mostCommonSeat,
      seatClassDistribution,
      avgRowNumber: rowCountWithNumber > 0 ? Math.round((rowTotal / rowCountWithNumber) * 10) / 10 : null,
    };

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ─── Airline Ranking ─────────────────────────────────────────────────────────

interface AirlineRankingItem {
  airline: string;
  count: number;
  percentage: number;
  /** IATA code via strict exact lookup; omitted when nothing matches. */
  iata?: string;
}

interface AirlineRankingResponse {
  airlines: AirlineRankingItem[];
  total: number;
  /** Flights carrying no airline — excluded from the ranking and from the
   *  percentage denominator, reported so the gap is visible rather than
   *  ranked as a carrier called "Unknown". */
  flightsWithoutAirline: number;
}

// GET /api/v1/stats/airlines — loyalty ranking by flight count.
// Scoped to flown + historical like every other aggregate in this file. It used
// to count every row, so a cancelled or still-scheduled booking inflated the
// ranking — and the statistics page put this card a few hundred pixels below
// the client-side breakdown, which has always used the narrower scope. Same
// airline, two numbers, one screen.
router.get('/airlines', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const where: Prisma.FlightWhereInput = { userId, ...countableFlightWhere() };

    const [total, airlineCounts] = await Promise.all([
      prisma.flight.count({ where }),
      prisma.flight.groupBy({
        by: ['airline'],
        where,
        _count: true,
        orderBy: { _count: { airline: 'desc' } },
      }),
    ]);

    // Merge duplicates caused by different import-source spellings.
    //
    // A row without an airline is NOT an airline. It used to be folded in
    // under the label "Unknown", which could top the loyalty ranking on an
    // account with many imported rows — and it sat in the percentage
    // denominator too, quietly diluting every real airline's share. Such rows
    // are excluded from both, and reported separately so the ranking can say
    // what it is silent about.
    const merged = new Map<string, number>();
    let flightsWithoutAirline = 0;
    for (const row of airlineCounts) {
      if (!row.airline || row.airline.trim().length === 0) {
        flightsWithoutAirline += row._count;
        continue;
      }
      const canonical = normalizeAirline(row.airline);
      merged.set(canonical, (merged.get(canonical) ?? 0) + row._count);
    }
    const attributedTotal = total - flightsWithoutAirline;

    const airlines: AirlineRankingItem[] = Array.from(merged.entries())
      .map(([airline, count]) => {
        const iata = resolveAirlineCodes(airline)?.iata;
        return {
          airline,
          count,
          percentage:
            attributedTotal > 0 ? Math.round((count / attributedTotal) * 1000) / 10 : 0,
          ...(iata ? { iata } : {}),
        };
      })
      .sort((a, b) => b.count - a.count);

    const response: AirlineRankingResponse = {
      airlines,
      total: attributedTotal,
      flightsWithoutAirline,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

// ─── Country Distribution ─────────────────────────────────────────────────────

/**
 * Fold a set of country names/codes into sorted, deduplicated ISO alpha-2.
 * Unresolvable entries are dropped: they cannot be deduplicated against the
 * other catalogue, so keeping them would reintroduce the double count this
 * exists to remove.
 */
function isoCodes(values: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const iso = isoCountryCode(v);
    if (iso) out.add(iso);
  }
  return [...out].sort();
}

interface CountryStat {
  country: string;
  count: number;
}

interface CountryStatsResponse {
  /** Display vocabulary, ranked by flight count. Rendered as-is. */
  countries: CountryStat[];
  total: number;
  /**
   * Counting vocabulary: lifetime countries VISITED as ISO alpha-2 — every
   * country either end of a flight touched, not just departures (#233) — with
   * `Unknown` and the catalogue's placeholders dropped. The cross-domain KPI
   * unions this with the port catalogue's equivalent; keeping unresolvable
   * entries would mean counting things that cannot be deduplicated.
   */
  countriesIso: string[];
  /**
   * Visited countries keyed by year, same ISO vocabulary. Both ends of a
   * flight land in its DEPARTURE year, so a red-eye is one journey rather
   * than a country visited in a year the traveller never flew. The cross-domain
   * overview used to render the lifetime set for whichever year was selected
   * and stack a year-over-year delta on top of it that could only ever read
   * zero — a comparison that could not exist, presented as data.
   *
   * The year is the one on the clock at the DEPARTURE airport (see
   * localWallClockOf), not the UTC instant. A flight without a departure time
   * still counts towards `countries` but belongs to no year.
   */
  byYear: Record<string, string[]>;
}

// GET /api/v1/stats/countries — visited-country distribution (both flight ends)
router.get('/countries', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const flights = await prisma.flight.findMany({
      where: { userId, ...countableFlightWhere() },
      select: {
        depIata: true,
        depIcao: true,
        arrIata: true,
        arrIcao: true,
        departureTime: true,
        depTimeSemantics: true,
      },
    });

    const airportCodes = new Set<string>();
    for (const f of flights) {
      if (f.depIata) airportCodes.add(f.depIata);
      else if (f.depIcao) airportCodes.add(f.depIcao);
      if (f.arrIata) airportCodes.add(f.arrIata);
      else if (f.arrIcao) airportCodes.add(f.arrIcao);
    }

    const airportMap = await getCachedAirports([...airportCodes]);

    const countryCounts = new Map<string, number>();
    const countriesByYear = new Map<number, Set<string>>();
    for (const f of flights) {
      // BOTH ends count. This used to read the departure only, so a single
      // FRA -> LHR reported "Länder besucht: 1" and the United Kingdom
      // appeared nowhere — the KPI says VISITED, and landing somewhere is
      // the clearest way to visit it (#233).
      const depCode = f.depIata ?? f.depIcao;
      const arrCode = f.arrIata ?? f.arrIcao;
      const depAirport = depCode ? airportMap.get(depCode) : undefined;
      const arrAirport = arrCode ? airportMap.get(arrCode) : undefined;

      // A Set per flight, so a domestic leg is ONE visit to that country
      // rather than two. Across flights the counts still accumulate, which
      // keeps `countries` usable as a ranking.
      const touched = new Set<string>();
      touched.add(depAirport?.country ?? 'Unknown');
      // Only when an arrival airport is actually on file — otherwise an
      // incomplete row would invent a second "Unknown" visit.
      if (arrCode) touched.add(arrAirport?.country ?? 'Unknown');

      for (const country of touched) {
        countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
      }

      // An undated flight cannot be attributed to a year. It stays in the
      // lifetime tally rather than being guessed into the current one.
      if (!f.departureTime) continue;
      // The timezone lives on the airport, not the flight — same source the
      // flight list uses to derive depTimezone. Both endpoints land in the
      // DEPARTURE year: a red-eye that lands after midnight is still one
      // journey, and splitting its two ends across two years would count a
      // country as visited in a year the traveller never flew.
      const year = localWallClockOf(
        f.departureTime,
        depAirport?.timezone ?? null,
        f.depTimeSemantics as FlightTimeSemantics,
      ).year;
      if (!Number.isFinite(year)) continue;
      const bucket = countriesByYear.get(year) ?? new Set<string>();
      for (const country of touched) bucket.add(country);
      countriesByYear.set(year, bucket);
    }

    const countries: CountryStat[] = [...countryCounts.entries()]
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);

    const byYear: Record<string, string[]> = {};
    for (const [year, set] of countriesByYear) {
      byYear[String(year)] = isoCodes(set);
    }

    const response: CountryStatsResponse = {
      countries,
      total: flights.length,
      countriesIso: isoCodes(countryCounts.keys()),
      byYear,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * Cruise-domain stats endpoint for the StatsPage cruise tab.
 *
 * Loads only the user's SAILED cruises (`status: { in: ['flown',
 * 'historical'] }` — the same done-predicate `/stats/countries` uses)
 * and pipes them through the shared `calculateCruiseStats` util. A
 * merely-booked 'scheduled' (or still-`in_progress`) cruise must not
 * inflate "gefahren" figures like cruisesCount or the visited-countries
 * list. The heavy Set<string> fields are serialised to sorted arrays for
 * JSON transport.
 */
router.get(
  '/cruise',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const [user, cruises] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { birthdate: true } }),
        prisma.cruise.findMany({
          where: { userId, ...countableFlightWhere() },
          include: {
            stops: { include: { port: true } },
            legs: { orderBy: { ordinal: 'asc' }, select: { distanceKm: true } },
            departurePort: true,
            arrivalPort: true,
          },
        }),
      ]);

      const cruiseStatsInput: CruiseStatsInput[] = cruises.map((c) => ({
        id: c.id,
        shipId: c.shipId,
        cruiseLine: c.cruiseLine,
        cabinType: c.cabinType,
        deck: c.deck,
        startDate: c.startDate,
        endDate: c.endDate,
        stops: c.stops.map((s) => ({
          portId: s.portId,
          port: s.port
            ? {
                id: s.port.id,
                name: s.port.name,
                city: s.port.city,
                country: s.port.country,
                region: s.port.region,
                unlocode: s.port.unlocode,
                lat: s.port.lat,
                lon: s.port.lon,
                timezone: s.port.timezone,
                isUserAdded: s.port.isUserAdded,
              }
            : null,
          dayNumber: s.dayNumber,
          isAtSea: s.isAtSea,
          arrivalTime: s.arrivalTime,
          departureTime: s.departureTime,
          unresolvedPortName: s.unresolvedPortName,
        })),
        departurePort: c.departurePort,
        arrivalPort: c.arrivalPort,
        legDistancesKm: c.legs.map((l) => l.distanceKm),
      }));

      // calculateCruiseStats expects the birthday as {month, day} for the
      // birthday-at-sea flag; pass undefined when the user has none set.
      // Date#getMonth() returns 0-11; rangeContainsMonthDay expects 1-12.
      // Without the +1, January birthdays would match nothing and every
      // other birthday would be off by one month — found by Codex audit.
      const userBirthday = user?.birthdate
        ? { month: user.birthdate.getMonth() + 1, day: user.birthdate.getDate() }
        : undefined;

      // Defensive parity with the flight stats endpoints: a calculation
      // error on one malformed cruise must not 500 the whole tab — fall
      // back to an empty stats object and log the cause.
      let stats: ReturnType<typeof calculateCruiseStats>;
      try {
        stats = calculateCruiseStats(cruiseStatsInput, userBirthday);
      } catch (calcError) {
        logger.error({
          operation: 'cruise_stats_calculation_failed',
          userId,
          error: calcError instanceof Error ? calcError.message : calcError,
        });
        stats = calculateCruiseStats([], userBirthday);
      }

      res.json({
        // Counts + ladders
        cruisesCount: stats.cruisesCount,
        cruisePortsUnique: stats.cruisePortsUnique,
        cruisePortsSingleMax: stats.cruisePortsSingleMax,
        cruiseShipsUnique: stats.cruiseShipsUnique,
        cruiseLinesUnique: stats.cruiseLinesUnique,
        cruiseLineLoyaltyMax: stats.cruiseLineLoyaltyMax,
        // Ranked by how often they were sailed, ties alphabetical. The
        // cross-domain tile slices the first five and labels them "Top", so a
        // purely alphabetical list put AIDA and Costa there for their
        // initials rather than for having been sailed.
        cruiseLines: Array.from(stats.cruiseLines).sort((a, b) => {
          const diff = (stats.cruiseLineCounts[b] ?? 0) - (stats.cruiseLineCounts[a] ?? 0);
          return diff !== 0 ? diff : a.localeCompare(b);
        }),
        resolvedPortCalls: stats.resolvedPortCalls,
        seaDays: stats.seaDays,
        seaDaysStreak: stats.seaDaysStreak,
        // Regions + countries (lists already in API; counts derived
        // client-side)
        regions: Array.from(stats.regions).sort(),
        regionVisitCounts: stats.regionVisitCounts,
        // Display vocabulary: English names, rendered as-is in the cruise
        // tab's country tag cloud. Do NOT switch these to codes.
        countries: Array.from(stats.countries).sort(),
        // Counting vocabulary: ISO alpha-2, so the cross-domain KPI can union
        // these with the airport catalogue's codes without counting "Germany"
        // and "DE" as two countries. Ports whose name does not resolve are
        // dropped from the COUNT rather than counted under their raw name —
        // an unresolvable name cannot be deduplicated against anything.
        countriesIso: isoCodes(stats.countries),
        // Year-scoped counterpart — see the CruiseStats doc comment. Keyed by
        // the cruise's start year so the overview's "countries visited" tile
        // can answer for a selected year instead of showing the lifetime set
        // with a delta on top that could only ever read zero.
        countriesByYear: Object.fromEntries(
          [...stats.countriesByYear.entries()].map(([year, set]) => [
            String(year),
            isoCodes(set),
          ]),
        ),
        // Distance metrics (added 2026-04-25 with the schematic-routes
        // pipeline; long-overdue exposure to the stats UI)
        totalDistanceKm: Math.round(stats.totalDistanceKm),
        longestLegKm: Math.round(stats.longestLegKm),
        // Trip-shape derivations
        totalPortCalls: stats.totalPortCalls,
        totalCruiseDays: stats.totalCruiseDays,
        // Cabin / deck signals
        hasBalconyCabin: stats.hasBalconyCabin,
        hasSuiteCabin: stats.hasSuiteCabin,
        maxDeck: stats.maxDeck,
        // Achievement-style flags
        hasCanalTransit: stats.hasCanalTransit,
        hasPolar: stats.hasPolar,
        hasColdWater: stats.hasColdWater,
        hasDatelineCrossing: stats.hasDatelineCrossing,
        hasBirthdayAtSea: stats.hasBirthdayAtSea,
        hasNewYearsAtSea: stats.hasNewYearsAtSea,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Lodging-domain stats endpoint for the StatsPage lodging tab.
 *
 * Loads the user's stays (own scope only — `where: { userId }`) with
 * their parent `Lodging` row, maps them to `LodgingStayData`, and pipes
 * them through the shared `calculateLodgingStats` (no arithmetic is
 * duplicated here). `countries` is a `Set<string>` on the return value —
 * a bare `Set` silently JSON-serializes to `{}`, so it is converted to a
 * sorted array before the response leaves this handler.
 */
router.get(
  '/lodging',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const [stays, lodgings, settings, memberships] = await Promise.all([
        prisma.lodgingStay.findMany({
          where: { userId },
          // The chain is joined for its NAME: the price and rating rankings
          // are read by a human, and a chain id is not a label.
          include: { lodging: { include: { chain: true } } },
        }),
        // Every lodging the user HAS, including ones with no stay yet — a
        // hotel added but never checked into must still count toward
        // lodgingsCount/chainsUnique (owner decision, finding 1).
        //
        // Loaded UNFILTERED on purpose: `visited === false` rows are needed
        // here, not to be counted as visits but to be counted as bookmarks
        // (`notedLodgingsCount`). Filtering them out in the query would make
        // that figure unreachable without a second round-trip.
        prisma.lodging.findMany({ where: { userId } }),
        // Current base currency — spendBaseTotal is filtered against it so a
        // stay snapshotted under an OLDER base currency never gets silently
        // added under the current one's label (finding 2).
        prisma.userSettings.findUnique({
          where: { userId },
          select: { baseCurrency: true },
        }),
        // Which card covered which stay is DERIVED, not stored: a membership
        // attached to a chain covers every stay at that chain without the user
        // restating it per stay. The link tables are what make that derivable.
        prisma.lodgingMembership.findMany({
          where: { userId },
          include: { chains: true, lodgings: true },
        }),
      ]);
      const baseCurrency = settings?.baseCurrency ?? 'EUR';
      const membershipContext = buildMembershipContext(memberships);
      /**
       * The key everything GROUPS or COUNTS on — never the free text.
       *
       * `schema.prisma` states this at `Lodging.isoCountryCode`: the text
       * field keeps whatever the source wrote ("Deutschland", "Germany",
       * "Schweiz/Suisse/Svizzera/Svizra"); grouping joins on the code. The
       * write paths obeyed it, this one did not, and the statistics page
       * listed "Deutschland" and "Germany" as two countries with the nights
       * and money split between them.
       *
       * The stored column wins. When it is empty the text is resolved on the
       * fly — the column arrived after some rows did, and an old row belongs
       * in the same bucket as a new one. When nothing resolves, the text
       * survives as its own key: "Dubai" is a city, and a row that names no
       * country is a finding worth seeing, not one to drop.
       *
       * It also repairs the continents: `continentForCountry` understands ISO
       * codes and English names, so German text used to fall through to the
       * deliberately coarse coordinate guess — and a house without
       * coordinates lost its continent altogether.
       */
      const countryKey = (l: { country: string | null; isoCountryCode: string | null }): string | null =>
        l.isoCountryCode ?? resolveCountryCode(l.country) ?? l.country;

      const lodgingRecords: LodgingRecord[] = lodgings.map((l) => ({
        id: l.id,
        chainId: l.chainId,
        type: l.type,
        country: countryKey(l),
        city: l.city,
        visited: l.visited,
      }));

      const stayData: LodgingStayData[] = stays.map((s) => {
        const programme = resolveStayProgramme(s, s.lodging.chainId, membershipContext);
        return {
        lodgingId: s.lodgingId,
        lodgingName: s.lodging.name,
        type: s.lodging.type,
        country: countryKey(s.lodging),
        city: s.lodging.city,
        chainId: s.lodging.chainId,
        chainName: s.lodging.chain?.name ?? null,
        stars: s.lodging.stars,
        lat: s.lodging.lat,
        lon: s.lodging.lon,
        checkIn: s.checkIn,
        checkOut: s.checkOut,
        datePrecision: s.datePrecision,
        nights: s.nights,
        status: s.status,
        totalPriceBase: s.totalPriceBase,
        fxBaseCurrency: s.fxBaseCurrency,
        currency: s.currency,
        totalPrice: s.totalPrice,
        board: s.board,
        isAwardStay: s.isAwardStay,
        ratingOverall: s.ratingOverall,
        ratingRoom: s.ratingRoom,
        ratingBreakfast: s.ratingBreakfast,
        ratingService: s.ratingService,
          programName: programme.programName,
          membershipTier: programme.tier,
        };
      });

      // Defensive parity with the cruise/flight stats endpoints: a
      // calculation error on one malformed stay must not 500 the whole
      // tab — fall back to an empty stats object and log the cause.
      let stats: ReturnType<typeof calculateLodgingStats>;
      try {
        stats = calculateLodgingStats(stayData, baseCurrency, lodgingRecords);
      } catch (calcError) {
        logger.error({
          operation: 'lodging_stats_calculation_failed',
          userId,
          error: calcError instanceof Error ? calcError.message : calcError,
        });
        stats = calculateLodgingStats([], baseCurrency, lodgingRecords);
      }

      res.json({
        success: true,
        data: {
          ...stats,
          countries: Array.from(stats.countries).sort(),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ─── Aircraft type ranking ──────────────────────────────────────────────────

interface AircraftTypeItem {
  aircraft: string;
  count: number;
  percentage: number;
}

interface AircraftTypesResponse {
  aircraftTypes: AircraftTypeItem[];
  total: number;
}

// GET /api/v1/stats/aircraft-types — ranking by aircraft TYPE ("Airbus A320neo").
// Distinct from /stats/aircraft, which ranks tail numbers and only sees
// registration-bearing (AeroDataBox-enriched) rows. `total` is the user's total
// flight count so this shares a denominator with /stats/airlines — and
// therefore that endpoint's flown + historical scope; flights with no
// `aircraft` value produce no row, so percentages need not sum to 100.
router.get(
  '/aircraft-types',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const where: Prisma.FlightWhereInput = { userId, ...countableFlightWhere() };

      const [total, typeCounts] = await Promise.all([
        prisma.flight.count({ where }),
        prisma.flight.groupBy({
          by: ['aircraft'],
          where: { ...where, aircraft: { not: null } },
          _count: true,
        }),
      ]);

      const aircraftTypes: AircraftTypeItem[] = typeCounts
        .map((row) => ({
          aircraft: row.aircraft!,
          count: row._count,
          percentage:
            total > 0 ? Math.round((row._count / total) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.count - a.count);

      const response: AircraftTypesResponse = { aircraftTypes, total };
      res.json(response);
    } catch (error) {
      next(error);
    }
  },
);

// ─── Aircraft (tail number) ─────────────────────────────────────────────────

interface AircraftRankingItem {
  registration: string;
  count: number;
  airline: string | null;
  aircraft: string | null;
  totalDistanceKm: number;
  firstFlightDate: string | null;
  lastFlightDate: string | null;
}

interface AircraftRankingResponse {
  aircraft: AircraftRankingItem[];
  total: number;
}

// GET /api/v1/stats/aircraft — top tail numbers ("Hulls" tab).
// Excludes flights without registration so the ranking only reflects
// AeroDataBox-enriched rows. The per-user index on
// (user_id, aircraft_registration) makes this cheap.
router.get(
  '/aircraft',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const flights = await prisma.flight.findMany({
        where: {
          userId,
          ...countableFlightWhere(),
          aircraftRegistration: { not: null },
        },
        select: {
          aircraftRegistration: true,
          airline: true,
          aircraft: true,
          depLat: true,
          depLon: true,
          arrLat: true,
          arrLon: true,
          departureTime: true,
        },
      });

      const buckets = new Map<string, AircraftRankingItem>();
      for (const f of flights) {
        const reg = f.aircraftRegistration!;
        const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
        const isoDate = f.departureTime ? f.departureTime.toISOString() : null;
        const existing = buckets.get(reg);
        if (existing) {
          existing.count += 1;
          existing.totalDistanceKm += dist;
          if (!existing.airline && f.airline) existing.airline = f.airline;
          if (!existing.aircraft && f.aircraft) existing.aircraft = f.aircraft;
          if (isoDate) {
            if (!existing.firstFlightDate || isoDate < existing.firstFlightDate) {
              existing.firstFlightDate = isoDate;
            }
            if (!existing.lastFlightDate || isoDate > existing.lastFlightDate) {
              existing.lastFlightDate = isoDate;
            }
          }
        } else {
          buckets.set(reg, {
            registration: reg,
            count: 1,
            airline: f.airline ?? null,
            aircraft: f.aircraft ?? null,
            totalDistanceKm: dist,
            firstFlightDate: isoDate,
            lastFlightDate: isoDate,
          });
        }
      }

      const aircraft = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
      const response: AircraftRankingResponse = { aircraft, total: aircraft.length };
      res.json(response);
    } catch (error) {
      next(error);
    }
  },
);

interface AircraftProfileFlight {
  id: string;
  flightNumber: string | null;
  airline: string | null;
  depIata: string | null;
  arrIata: string | null;
  depName: string | null;
  arrName: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  distanceKm: number;
  status: string;
}

interface AircraftProfileResponse {
  registration: string;
  modeS: string | null;
  airline: string | null;
  aircraft: string | null;
  flightCount: number;
  totalDistanceKm: number;
  firstFlightDate: string | null;
  lastFlightDate: string | null;
  uniqueAirports: number;
  flights: AircraftProfileFlight[];
}

// GET /api/v1/stats/aircraft/:registration — per-tail profile.
// Returns aggregate stats plus the user's flights on that hull, newest
// first. 404 if the user has no flights with that registration.
router.get(
  '/aircraft/:registration',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const registration = req.params['registration'];
      if (!registration || registration.length > 20) {
        res.status(400).json({ error: 'Invalid registration' });
        return;
      }
      const flights = await prisma.flight.findMany({
        where: { userId, aircraftRegistration: registration },
        orderBy: { departureTime: 'desc' },
      });

      if (flights.length === 0) {
        res.status(404).json({ error: 'NO_FLIGHTS_FOR_AIRCRAFT' });
        return;
      }

      const airports = new Set<string>();
      let totalDistanceKm = 0;
      let firstDate: string | null = null;
      let lastDate: string | null = null;
      let modeS: string | null = null;
      let airline: string | null = null;
      let aircraft: string | null = null;

      const flightItems: AircraftProfileFlight[] = flights.map((f) => {
        const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
        totalDistanceKm += dist;
        if (f.depIata) airports.add(f.depIata);
        if (f.arrIata) airports.add(f.arrIata);
        const iso = f.departureTime ? f.departureTime.toISOString() : null;
        if (iso) {
          if (!firstDate || iso < firstDate) firstDate = iso;
          if (!lastDate || iso > lastDate) lastDate = iso;
        }
        if (!modeS && f.aircraftModeS) modeS = f.aircraftModeS;
        if (!airline && f.airline) airline = f.airline;
        if (!aircraft && f.aircraft) aircraft = f.aircraft;
        return {
          id: f.id,
          flightNumber: f.flightNumber ?? null,
          airline: f.airline ?? null,
          depIata: f.depIata ?? null,
          arrIata: f.arrIata ?? null,
          depName: f.depName ?? null,
          arrName: f.arrName ?? null,
          departureTime: iso,
          arrivalTime: f.arrivalTime ? f.arrivalTime.toISOString() : null,
          distanceKm: dist,
          status: f.status,
        };
      });

      const response: AircraftProfileResponse = {
        registration,
        modeS,
        airline,
        aircraft,
        flightCount: flights.length,
        totalDistanceKm,
        firstFlightDate: firstDate,
        lastFlightDate: lastDate,
        uniqueAirports: airports.size,
        flights: flightItems,
      };
      res.json(response);
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/v1/stats/punctuality — actual-vs-scheduled aggregates (#2).
// Reads the stored per-flight delayMinutes captured since 2.5; no new lookups.
router.get('/punctuality', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const parsed = DateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.errors });
      return;
    }
    const { fromDate, toDate } = parsed.data;

    const where: Prisma.FlightWhereInput = {
      userId,
      ...countableFlightWhere(),
      delayMinutes: { not: null },
    };
    if (fromDate || toDate) {
      where.departureTime = {};
      if (fromDate) where.departureTime.gte = new Date(fromDate);
      if (toDate) where.departureTime.lte = new Date(toDate);
    }

    const flights = await prisma.flight.findMany({
      where,
      select: {
        delayMinutes: true,
        airline: true,
        airlineIata: true,
        depIata: true,
        arrIata: true,
      },
    });

    res.json(computePunctuality(flights));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/stats/travel-account — the cross-domain night account plus the
 * per-trip rollup.
 *
 * One endpoint for both because a screen that asks "where did I sleep this
 * year" invariably asks "and which trip has a gap" next, and two round-trips
 * for one question is two chances to show half an answer.
 */
router.get(
  '/travel-account',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const [stays, cruises, flights, trips] = await Promise.all([
        prisma.lodgingStay.findMany({
          where: { userId },
          select: {
            status: true,
            checkIn: true,
            checkOut: true,
            datePrecision: true,
            nights: true,
          },
        }),
        prisma.cruise.findMany({
          where: { userId },
          select: { status: true, startDate: true, endDate: true },
        }),
        prisma.flight.findMany({
          where: { userId },
          select: { status: true, departureTime: true, arrivalTime: true },
        }),
        prisma.trip.findMany({
          where: { userId },
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            status: true,
            category: true,
            tags: true,
            journalEntries: { select: { mood: true, weather: true } },
            _count: { select: { photos: true } },
            lodgingStays: {
              select: {
                status: true,
                checkIn: true,
                checkOut: true,
                datePrecision: true,
                nights: true,
                totalPrice: true,
                currency: true,
                totalPriceBase: true,
                fxBaseCurrency: true,
              },
            },
            cruises: {
              select: {
                status: true,
                startDate: true,
                endDate: true,
                price: true,
                currency: true,
              },
            },
            flights: {
              select: {
                status: true,
                departureTime: true,
                arrivalTime: true,
                price: true,
                currency: true,
              },
            },
          },
        }),
      ]);

      const now = new Date();
      const account = buildTravelAccount({ stays, cruises, flights, now });
      const tripAccount = buildTripAccount(
        trips.map((t) => ({
          id: t.id,
          name: t.name,
          startDate: t.startDate,
          endDate: t.endDate,
          status: t.status,
          category: t.category,
          tags: t.tags,
          journalEntries: t.journalEntries,
          photoCount: t._count.photos,
          stays: t.lodgingStays,
          cruises: t.cruises,
          flights: t.flights,
        })),
      );

      res.json({ account, trips: tripAccount });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
