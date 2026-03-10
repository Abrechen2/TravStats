import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { calculateDistance } from '../utils/geo';
import { Prisma } from '@prisma/client';
import { calculateFunStats, calculateBusinessStats, calculateUniqueStats } from '../utils/statsCalculator';
import logger from '../utils/logger';
import { statsLimiter } from '../middleware/rateLimit';

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
  const [flights, statusCounts, airlineCounts, categoryCounts, costAgg] = await Promise.all([
    prisma.flight.findMany({
      where,
      select: {
        depLat: true,
        depLon: true,
        arrLat: true,
        arrLon: true,
        departureTime: true,
        arrivalTime: true,
      },
    }),
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

  flights.forEach(flight => {
    const distance = calculateDistance(
      flight.depLat,
      flight.depLon,
      flight.arrLat,
      flight.arrLon
    );
    totalDistance += distance;

    const flightTime =
      (flight.arrivalTime.getTime() - flight.departureTime.getTime()) / 1000 / 60;
    totalFlightTime += flightTime;
  });

  const avgDistance = flights.length > 0 ? totalDistance / flights.length : 0;

  const byStatus = statusCounts.reduce((acc, item) => {
    acc[item.status] = item._count;
    return acc;
  }, {} as Record<string, number>);

  const byAirline = airlineCounts.reduce((acc, item) => {
    const airline = item.airline || 'Unknown';
    acc[airline] = item._count;
    return acc;
  }, {} as Record<string, number>);

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
    totalFlights: flights.length,
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
      where: { userId },
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

    // Calculate unique stats with error handling - continue even if airport data fails
    let uniqueStats;
    try {
      uniqueStats = await calculateUniqueStats(flights);
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
      };
    }

    res.json(uniqueStats);
  } catch (error) {
    next(error);
  }
});

export default router;
