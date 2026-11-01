/**
 * `GET /stats/fun`, `/business`, `/unique` and `/airports` — the figures
 * derived from the flight rows by `utils/statsCalculator`.
 *
 * Split out of `routes/stats.ts` (frozen by the size ratchet, forgejo#386
 * REF-16), mounted from there at the position these handlers used to occupy;
 * `authenticate` and `statsEtag` run in the parent before this router.
 */

import { Router, Response, NextFunction } from "express";
import { DateRangeQuerySchema, DateRangeYearQuerySchema } from "../../schemas/statsQuery";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { Prisma } from "../../prisma";
import {
  calculateFunStats,
  calculateBusinessStats,
  calculateUniqueStats,
  calculateAirportStats,
} from "../../utils/statsCalculator";
import { userToday } from "../../services/stats/userToday";
import { FLIGHT_CLOCK_SELECT, withDepartureClock } from "../../services/stats/departureClock";
import { buildWhere } from "../../services/stats/summary";
import { countableFlightWhere } from "../../shared/flightCounting";
import { assertYearWithoutRange, statsScope } from "../../utils/stats/domainYear";
import { getBaseCurrency } from "../../services/fx/snapshot";
import { loadHomePeriods } from "../../services/home/homeStore";

const router = Router();

// Get fun/entertaining statistics
router.get("/fun", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const parsed = DateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
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
        ...FLIGHT_CLOCK_SELECT,
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

    // A calculator failure is a failure, not a page of zeros: it reaches
    // next(error) as a 5xx, the same answer /stats/page gives (forgejo#368).
    const funStats = await calculateFunStats(await withDepartureClock(flights));

    res.json(funStats);
  } catch (error) {
    next(error);
  }
});

// Get business/informative statistics
router.get(
  "/business",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;

      const parsed = DateRangeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
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
          ...FLIGHT_CLOCK_SELECT,
          airline: true,
          aircraft: true,
          departureTime: true,
          arrivalTime: true,
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

      const businessStats = calculateBusinessStats(
        await withDepartureClock(flights),
        await getBaseCurrency(userId)
      );

      res.json(businessStats);
    } catch (error) {
      next(error);
    }
  }
);

// Get unique/special statistics
router.get(
  "/unique",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;

      const parsed = DateRangeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
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
          ...FLIGHT_CLOCK_SELECT,
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

      // Home by date, so layovers exclude returns to any home airport of that date.
      const homePeriods = await loadHomePeriods(userId);

      const uniqueStats = await calculateUniqueStats(
        await withDepartureClock(flights),
        homePeriods
      );

      res.json(uniqueStats);
    } catch (error) {
      next(error);
    }
  }
);

// Airport-focused statistics (top airports, rarest, farthest from home, etc.)
router.get(
  "/airports",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;

      const parsed = DateRangeYearQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
        return;
      }
      const { fromDate, toDate, year } = parsed.data;
      assertYearWithoutRange(parsed.data);

      // Airport stats are time-insensitive (counts, country/continent, distance),
      // so historical flights are included.
      const where: Prisma.FlightWhereInput = {
        ...(await buildWhere(userId, undefined, undefined, year)),
        ...countableFlightWhere(),
      };
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
          ...FLIGHT_CLOCK_SELECT,
          departureTime: true,
          arrivalTime: true,
          status: true,
          createdAt: true,
        },
      });

      const [homePeriods, today] = await Promise.all([loadHomePeriods(userId), userToday(userId)]);
      const stats = await calculateAirportStats(
        await withDepartureClock(flights),
        homePeriods,
        today
      );
      res.json({ ...stats, scope: statsScope(year) });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
