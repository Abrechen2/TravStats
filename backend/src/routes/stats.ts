import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { calculateDistance } from '../utils/geo';
import { getCachedAirports } from '../services/airportCache';
import { Prisma } from '@prisma/client';
import {
  calculateFunStats,
  calculateBusinessStats,
  calculateUniqueStats,
  calculateAirportStats,
} from '../utils/statsCalculator';
import { calculateCruiseStats, type CruiseData as CruiseStatsInput } from '../utils/cruiseStats';
import { normalizeHistory } from '../utils/homeAirport';
import type { SettingsDataJson } from './settings/types';
import logger from '../utils/logger';
import { tzAwareDurationMinutes, localYearOf, type FlightTimeSemantics } from '../utils/timezone';
import { isoCountryCode } from '../utils/continents';
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
  type DatedRow,
} from '../utils/stats/timeseries';
import { computeDedupedTotalCost } from '../utils/stats/dedupedCost';

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
  totalDistance: number;
  totalFlightTime: number;
  avgDistance: number;
  byStatus: Record<string, number>;
  byAirline: Record<string, number>;
  totalCost: number;
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

async function computeSummary(where: Prisma.FlightWhereInput): Promise<SummaryStats> {
  // Distance and flight time only count flown+historical flights; totalFlights, status/airline/category
  // counts use the original where so that planned and cancelled flights are visible.
  const geoWhere: Prisma.FlightWhereInput = { ...where, status: { in: ['flown', 'historical'] } };

  const [flownFlights, totalFlights, statusCounts, airlineCounts, categoryCounts, costFlights] = await Promise.all([
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
      },
    }),
    prisma.flight.count({ where }),
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
      where,
      select: {
        price: true,
        taxes: true,
        fees: true,
        bookingId: true,
        booking: { select: { price: true } },
      },
    }),
  ]);

  let totalDistance = 0;
  let totalFlightTime = 0;

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

    const depTz = (flight.depIata && tzMap.get(flight.depIata))
      || (flight.depIcao && tzMap.get(flight.depIcao))
      || null;
    const arrTz = (flight.arrIata && tzMap.get(flight.arrIata))
      || (flight.arrIcao && tzMap.get(flight.arrIcao))
      || null;
    const flightTime = (flight.departureTime && flight.arrivalTime)
      ? tzAwareDurationMinutes(
          flight.departureTime,
          flight.arrivalTime,
          depTz,
          arrTz,
          flight.depTimeSemantics as FlightTimeSemantics,
          flight.arrTimeSemantics as FlightTimeSemantics,
        )
      : null;
    // null durations (DATE_ONLY rows) are skipped — they would otherwise
    // poison the aggregate with placeholder-time fictions (issue #106A).
    totalFlightTime += flightTime ?? 0;
  });

  const avgDistance = flownFlights.length > 0 ? totalDistance / flownFlights.length : 0;

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
  const totalCost = computeDedupedTotalCost(costFlights);

  return {
    totalFlights,
    totalDistance: Math.round(totalDistance),
    totalFlightTime: Math.round(totalFlightTime),
    avgDistance: Math.round(avgDistance),
    byStatus,
    byAirline,
    totalCost,
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

    if (year !== undefined && compareYear !== undefined) {
      // Return comparison response: { current, compare }
      const [current, compare] = await Promise.all([
        computeSummary(buildWhere(userId, fromDate, toDate, year)),
        computeSummary(buildWhere(userId, fromDate, toDate, compareYear)),
      ]);
      res.json({ current, compare });
    } else {
      // Return flat summary (backward-compatible)
      const summary = await computeSummary(buildWhere(userId, fromDate, toDate, year));
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
      status: { in: ['flown', 'historical'] },
    };

    const [summary, flights] = await Promise.all([
      computeSummary(buildWhere(userId, undefined, undefined)),
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

    // homeAirportHistory=[] is deliberate: this endpoint only reads
    // countryCount/airportCount, which don't depend on home-airport history —
    // only the unused farthestFromHome field does. Skips /airports's extra
    // userSettings.findUnique lookup.
    const [airportStats, funStats] = await Promise.all([
      calculateAirportStats(flights, []),
      calculateFunStats(flights),
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

async function fetchFlightDatedRows(
  userId: string,
  from: Date,
  to: Date,
): Promise<DatedRow[]> {
  const rows = await prisma.flight.findMany({
    where: {
      userId,
      status: { in: ['flown', 'historical'] },
      departureTime: { gte: from, lt: to },
    },
    select: {
      depIata: true, depIcao: true, depLat: true, depLon: true,
      arrIata: true, arrIcao: true, arrLat: true, arrLon: true,
      departureTime: true, arrivalTime: true,
      depTimeSemantics: true, arrTimeSemantics: true,
    },
  });
  const tzMap = await buildTzMap(rows);
  return rows.map((f) => {
    const depTz = (f.depIata && tzMap.get(f.depIata)) || (f.depIcao && tzMap.get(f.depIcao)) || null;
    const arrTz = (f.arrIata && tzMap.get(f.arrIata)) || (f.arrIcao && tzMap.get(f.arrIcao)) || null;
    const durationMin =
      f.departureTime && f.arrivalTime
        ? tzAwareDurationMinutes(
            f.departureTime, f.arrivalTime, depTz, arrTz,
            f.depTimeSemantics as FlightTimeSemantics,
            f.arrTimeSemantics as FlightTimeSemantics,
          ) ?? 0
        : 0;
    return {
      date: f.departureTime as Date,
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
    where: { userId, status: { not: 'cancelled' }, startDate: { gte: from, lt: to } },
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
    const [currentRows, previousRows] = await Promise.all([
      fetchRows(userId, w.from, w.to),
      w.prevFrom && w.prevTo ? fetchRows(userId, w.prevFrom, w.prevTo) : Promise.resolve([] as DatedRow[]),
    ]);

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
      where: { userId, status: { in: ['flown', 'historical'] } },
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

    // Group by route
    const routeMap = new Map<string, {
      count: number;
      departure: { iata?: string; name?: string; lat: number; lon: number };
      arrival: { iata?: string; name?: string; lat: number; lon: number };
      distance: number;
    }>();

    flights.forEach(flight => {
      const routeKey = `${flight.depIata || flight.depIcao}-${flight.arrIata || flight.arrIcao}`;

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
    const where: Prisma.FlightWhereInput = { userId, status: { in: ['flown', 'historical'] } };

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
      funStats = await calculateFunStats(flights);
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
    const where: Prisma.FlightWhereInput = { userId, status: { in: ['flown', 'historical'] } };

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
        status: true,
        price: true,
        taxes: true,
        fees: true,
        category: true,
        seatClass: true,
        createdAt: true,
        bookingId: true,
        booking: { select: { id: true, price: true, currency: true } },
      },
    });

    // Business stats don't require database lookups, so they should be safe
    // But wrap in try-catch for safety
    let businessStats;
    try {
      businessStats = calculateBusinessStats(flights);
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
    const where: Prisma.FlightWhereInput = { userId, status: { in: ['flown', 'historical'] } };

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
      uniqueStats = await calculateUniqueStats(flights, homeHistory);
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
      const where: Prisma.FlightWhereInput = { userId, status: { in: ['flown', 'historical'] } };
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

      const stats = await calculateAirportStats(flights, homeHistory);
      res.json(stats);
    } catch (error) {
      next(error);
    }
  }
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
    const where: Prisma.FlightWhereInput = { userId, status: { in: ['flown', 'historical'] } };

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
}

// GET /api/v1/stats/airlines — loyalty ranking by flight count
router.get('/airlines', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const [total, airlineCounts] = await Promise.all([
      prisma.flight.count({ where: { userId } }),
      prisma.flight.groupBy({
        by: ['airline'],
        where: { userId },
        _count: true,
        orderBy: { _count: { airline: 'desc' } },
      }),
    ]);

    // Merge duplicates caused by different import-source spellings
    const merged = new Map<string, number>();
    for (const row of airlineCounts) {
      const canonical = normalizeAirline(row.airline ?? 'Unknown');
      merged.set(canonical, (merged.get(canonical) ?? 0) + row._count);
    }

    const airlines: AirlineRankingItem[] = Array.from(merged.entries())
      .map(([airline, count]) => {
        const iata = resolveAirlineCodes(airline)?.iata;
        return {
          airline,
          count,
          percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
          ...(iata ? { iata } : {}),
        };
      })
      .sort((a, b) => b.count - a.count);

    const response: AirlineRankingResponse = { airlines, total };
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
   * Counting vocabulary: lifetime departure countries as ISO alpha-2, with
   * `Unknown` and the catalogue's placeholders dropped. The cross-domain KPI
   * unions this with the port catalogue's equivalent; keeping unresolvable
   * entries would mean counting things that cannot be deduplicated.
   */
  countriesIso: string[];
  /**
   * Departure countries keyed by year, same ISO vocabulary. The cross-domain
   * overview used to render the lifetime set for whichever year was selected
   * and stack a year-over-year delta on top of it that could only ever read
   * zero — a comparison that could not exist, presented as data.
   *
   * The year is the one on the clock at the DEPARTURE airport (see
   * localYearOf), not the UTC instant. A flight without a departure time
   * still counts towards `countries` but belongs to no year.
   */
  byYear: Record<string, string[]>;
}

// GET /api/v1/stats/countries — departure country distribution
router.get('/countries', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const flights = await prisma.flight.findMany({
      where: { userId },
      select: { depIata: true, depIcao: true, departureTime: true },
    });

    const airportCodes = new Set<string>();
    for (const f of flights) {
      if (f.depIata) airportCodes.add(f.depIata);
      else if (f.depIcao) airportCodes.add(f.depIcao);
    }

    const airportMap = await getCachedAirports([...airportCodes]);

    const countryCounts = new Map<string, number>();
    const countriesByYear = new Map<number, Set<string>>();
    for (const f of flights) {
      const code = f.depIata ?? f.depIcao;
      const airport = code ? airportMap.get(code) : undefined;
      const country = airport?.country ?? 'Unknown';
      countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);

      // An undated flight cannot be attributed to a year. It stays in the
      // lifetime tally rather than being guessed into the current one.
      if (!f.departureTime) continue;
      // The timezone lives on the airport, not the flight — same source the
      // flight list uses to derive depTimezone.
      const year = localYearOf(f.departureTime, airport?.timezone ?? null);
      if (!Number.isFinite(year)) continue;
      const bucket = countriesByYear.get(year) ?? new Set<string>();
      bucket.add(country);
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
 * Loads the user's cruises (excluding cancelled ones, same scope as the
 * achievement engine uses) and pipes them through the shared
 * `calculateCruiseStats` util. The heavy Set<string> fields are
 * serialised to sorted arrays for JSON transport.
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
          where: { userId, status: { not: 'cancelled' } },
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
        cruiseLines: Array.from(stats.cruiseLines).sort(),
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
// flight count so this shares a denominator with /stats/airlines; flights with
// no `aircraft` value produce no row, so percentages need not sum to 100.
router.get(
  '/aircraft-types',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;

      const [total, typeCounts] = await Promise.all([
        prisma.flight.count({ where: { userId } }),
        prisma.flight.groupBy({
          by: ['aircraft'],
          where: { userId, aircraft: { not: null } },
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

export default router;
