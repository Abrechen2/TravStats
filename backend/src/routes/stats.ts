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
import { normalizeHistory } from '../utils/homeAirport';
import type { SettingsDataJson } from './settings/types';
import logger from '../utils/logger';
import { statsLimiter } from '../middleware/rateLimit';
import { tzAwareDurationMinutes } from '../utils/timezone';
import { normalizeAirline, mergeAirlineCounts } from '../utils/airlineNormalize';

const router = Router();

// All routes require authentication and are rate-limited
router.use(authenticate);
router.use(statsLimiter);

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

  const [flownFlights, totalFlights, statusCounts, airlineCounts, categoryCounts, costAgg] = await Promise.all([
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
    prisma.flight.aggregate({
      where,
      _sum: {
        price: true,
        taxes: true,
        fees: true,
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
      ? tzAwareDurationMinutes(flight.departureTime, flight.arrivalTime, depTz, arrTz)
      : 0;
    totalFlightTime += flightTime;
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

  const costParts = [
    costAgg._sum.price,
    costAgg._sum.taxes,
    costAgg._sum.fees,
  ].filter((v): v is number => typeof v === 'number');
  const totalCost = costParts.length > 0 ? costParts.reduce((a, b) => a + b, 0) : 0;

  return {
    totalFlights,
    totalDistance: Math.round(totalDistance),
    totalFlightTime: Math.round(totalFlightTime),
    avgDistance: Math.round(avgDistance),
    byStatus,
    byAirline,
    totalCost: Math.round(totalCost * 100) / 100,
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

    const flights = await prisma.flight.findMany({
      where: { userId, status: 'flown' },
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

    const where: Prisma.FlightWhereInput = { userId, status: 'flown' };

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

    const where: Prisma.FlightWhereInput = { userId, status: 'flown' };

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

    const where: Prisma.FlightWhereInput = { userId, status: 'flown' };

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

      const where: Prisma.FlightWhereInput = { userId, status: 'flown' };
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

    const where: Prisma.FlightWhereInput = { userId, status: 'flown' };

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
      .map(([airline, count]) => ({
        airline,
        count,
        percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const response: AirlineRankingResponse = { airlines, total };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

// ─── Country Distribution ─────────────────────────────────────────────────────

interface CountryStat {
  country: string;
  count: number;
}

interface CountryStatsResponse {
  countries: CountryStat[];
  total: number;
}

// GET /api/v1/stats/countries — departure country distribution
router.get('/countries', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const flights = await prisma.flight.findMany({
      where: { userId },
      select: { depIata: true, depIcao: true },
    });

    const airportCodes = new Set<string>();
    for (const f of flights) {
      if (f.depIata) airportCodes.add(f.depIata);
      else if (f.depIcao) airportCodes.add(f.depIcao);
    }

    const airportMap = await getCachedAirports([...airportCodes]);

    const countryCounts = new Map<string, number>();
    for (const f of flights) {
      const code = f.depIata ?? f.depIcao;
      const country = code ? (airportMap.get(code)?.country ?? 'Unknown') : 'Unknown';
      countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
    }

    const countries: CountryStat[] = [...countryCounts.entries()]
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);

    const response: CountryStatsResponse = { countries, total: flights.length };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
