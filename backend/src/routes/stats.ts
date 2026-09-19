import { Router, Response, NextFunction } from "express";
import aircraftStatsRouter from "./stats/aircraft";
import statsPageRouter from "./stats/page";
import {
  CountryCodeParamSchema,
  DateRangeQuerySchema,
  RoutesQuerySchema,
  SummaryQuerySchema,
  TimeseriesQuerySchema,
  WrappedQuerySchema,
} from "../schemas/statsQuery";
import { prisma } from "../db";
import { authenticate, AuthRequest } from "../middleware/auth";
import { calculateDistance } from "../utils/geo";
import { getCachedAirports } from "../services/airportCache";
import type { AirportData } from "../services/airportLookup";
import { buildFlightNetwork } from "../services/stats/network";
import { computePunctuality } from "../services/punctualityStats";
import { Prisma } from "../prisma";
import {
  calculateFunStats,
  calculateBusinessStats,
  calculateUniqueStats,
  calculateAirportStats,
} from "../utils/statsCalculator";
import { calculateCruiseStats, type CruiseData as CruiseStatsInput } from "../utils/cruiseStats";
import { calculateLodgingStats } from "../utils/lodgingStats";
import logger from "../utils/logger";
import { localWallClockOf } from "../utils/timezone";
import { withDepartureClock } from "../services/stats/departureClock";
import { loadPassport } from "../services/stats/passportLoader";
import { buildWhere, computeSummary } from "../services/stats/summary";
import { loadDaysAway } from "../services/stats/daysAwayLoader";
import { loadCountryDetail } from "../services/stats/countryDetailLoader";
import { buildWrapped } from "../services/stats/wrapped";
import { fetchFlightDatedRows, fetchCruiseDatedRows } from "../services/stats/timeseriesRows";
import { buildTravelRecords } from "../services/stats/records";
import { enrichFlightsWithAirportFacts } from "../services/flightAirportFacts";
import { countableFlightWhere } from "../shared/flightCounting";
import {
  resolveWindow,
  bucketSeries,
  sumTotals,
  trimZeroEdges,
  withinWindow,
  type DatedRow,
} from "../utils/stats/timeseries";
import { readYearQuery } from "../utils/stats/domainYear";
import { buildTravelAccount } from "../services/stats/travelAccount";
import { loadTravelAccountData } from "../services/stats/travelAccountData";
import { loadCruiseStatsData } from "../services/stats/cruiseStatsData";
import { loadLodgingStatsData } from "../services/stats/lodgingStatsData";
import { buildTripAccount } from "../services/stats/tripAccount";
import { getBaseCurrency } from "../services/fx/snapshot";
import { statsEtag } from "../middleware/statsEtag";
// Folds shared with the composing `GET /stats/page` (forgejo#49): one home per
// figure, so the two surfaces cannot answer the same question differently.
import { computeSeatStats } from "../services/stats/seatStats";
import { computeCountryStats, isoCodes } from "../services/stats/countryStats";
import { computeAirlineRanking } from "../services/stats/airlineRanking";
import { loadHomeAirportHistory } from "../services/stats/homeAirportHistory";

const router = Router();

// Authenticated per-user DB aggregations — a single stats page load fans
// out to 5–10 endpoints (overview, airlines, countries, cruise, etc.), so a
// per-user rate limit punishes the legitimate user more than it prevents
// abuse. Same reasoning we applied to /settings. Auth alone is enough here.
router.use(authenticate);

// Conditional GET: an unchanged account answers 304 without recomputing
// (forgejo#50). Must run AFTER authenticate — the fingerprint is per user.
router.use(statsEtag);

// Get summary statistics
router.get(
  "/summary",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;

      const parsed = SummaryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
        return;
      }
      const { fromDate, toDate, year, compareYear } = parsed.data;
      const baseCurrency = await getBaseCurrency(userId);

      // `daysAway` rides on every summary, scoped like its flight figures (forgejo#92).
      const summarize = async (scopeYear: number | undefined) => {
        const where = await buildWhere(userId, fromDate, toDate, scopeYear);
        const { stats } = await computeSummary(where, baseCurrency);
        const daysAway = await loadDaysAway(userId, { year: scopeYear, fromDate, toDate });
        return { ...stats, daysAway };
      };
      if (year !== undefined && compareYear !== undefined) {
        const [current, compare] = await Promise.all([summarize(year), summarize(compareYear)]);
        res.json({ current, compare });
      } else {
        res.json(await summarize(year));
      }
    } catch (error) {
      next(error);
    }
  }
);

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
router.get("/hero", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const flightsWhere: Prisma.FlightWhereInput = {
      userId,
      ...countableFlightWhere(),
    };
    const baseCurrency = await getBaseCurrency(userId);

    // Read the flight table THREE times per request until forgejo#49: in
    // computeSummary, inside loadPassport, and here. `arrTimeSemantics` is the
    // one column below the passport needed and this did not have, so the same
    // rows now serve both. The cost is the parallelism between this scan and
    // the passport — the smaller price, since a full per-user scan is not
    // worth running twice concurrently to save the latency of running it once.
    const [{ stats: summary }, flights] = await Promise.all([
      buildWhere(userId, undefined, undefined).then((w) => computeSummary(w, baseCurrency)),
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
          arrTimeSemantics: true,
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
    const passport = await loadPassport(userId, flights);
    const datedFlights = await withDepartureClock(flights);

    // homeAirportHistory=[] is deliberate: this endpoint only reads
    // airportCount, which doesn't depend on home-airport history — only the
    // unused farthestFromHome field does. Skips /airports's extra
    // userSettings.findUnique lookup.
    const [airportStats, funStats] = await Promise.all([
      calculateAirportStats(datedFlights, []),
      calculateFunStats(datedFlights),
    ]);

    const hero: HeroStats = {
      distanceKm: summary.totalDistance,
      flights: summary.totalFlights,
      /**
       * The SAME number the passport shows, from the same module — not
       * `airportStats.countryCount`, which this tile read until 2026-09-03.
       *
       * That field counts the countries a FLIGHT touched. It is blind to a
       * country reached by car and slept in for a week, and it counts one
       * reached by a four-hour connection, so it was wrong in both directions
       * at once — which is why it looked plausible for so long.
       *
       * This tile is the Companion's Start board, and the Companion draws a
       * passport too. One screen therefore had two answers to "how many
       * countries", which is the exact drift the design named as the reason
       * for a single home: "folding lodging in without unifying the rule
       * would create a fifth answer" (§4 of the country-counting design).
       * The tile was that answer.
       */
      countries: passport.summary.countries,
      airports: airportStats.airportCount,
      co2Kg: funStats.co2FootprintKg,
      flightTimeMinutes: summary.totalFlightTime,
    };

    res.json(hero);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/stats/timeseries — bucketed series (month|year) + current/previous
// window totals, domain-parameterized (flight|cruise). Powers the Wave A
// stats redesign's trend charts.
router.get(
  "/timeseries",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const parsed = TimeseriesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
        return;
      }
      const { domain, granularity, window, year, fromDate, toDate } = parsed.data;
      const w = resolveWindow(window, year, fromDate, toDate, new Date());

      const fetchRows = domain === "cruise" ? fetchCruiseDatedRows : fetchFlightDatedRows;
      const [fetchedCurrent, fetchedPrevious] = await Promise.all([
        fetchRows(userId, w.from, w.to),
        w.prevFrom && w.prevTo
          ? fetchRows(userId, w.prevFrom, w.prevTo)
          : Promise.resolve([] as DatedRow[]),
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
        window === "all" && !fromDate && !toDate ? trimZeroEdges(rawSeries) : rawSeries;

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
  }
);

// Get top routes
router.get(
  "/routes",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;

      const parsed = RoutesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
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
      const routeMap = new Map<
        string,
        {
          count: number;
          departure: { iata?: string; name?: string; lat: number; lon: number };
          arrival: { iata?: string; name?: string; lat: number; lon: number };
          distance: number;
        }
      >();

      flights.forEach((flight) => {
        const depCode = flight.depIata || flight.depIcao;
        const arrCode = flight.arrIata || flight.arrIcao;
        // Sorted, so both directions land on one key. `String()` guards the
        // null-code case, which would otherwise sort inconsistently.
        const routeKey = [String(depCode), String(arrCode)].sort().join("-");

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
            distance: calculateDistance(flight.depLat, flight.depLon, flight.arrLat, flight.arrLon),
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
  }
);

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
router.get(
  "/network",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
          operation: "stats_network_airport_lookup_failed",
          message: "Airport catalogue unavailable, building network from flight rows only",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }

      res.json(buildFlightNetwork(flights, catalogue));
    } catch (error) {
      next(error);
    }
  }
);

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
        operation: "calculate_fun_stats_error",
        message: "Failed to calculate fun stats, returning partial data",
        error: statsError instanceof Error ? statsError.message : "Unknown error",
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
          await getBaseCurrency(userId)
        );
      } catch (statsError) {
        logger.error({
          operation: "calculate_business_stats_error",
          message: "Failed to calculate business stats",
          error: statsError instanceof Error ? statsError.message : "Unknown error",
        });
        // Return minimal response
        businessStats = {
          costPerKm: 0,
          costPerHour: 0,
          totalCost: null,
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
      const homeHistory = await loadHomeAirportHistory(userId);

      // Calculate unique stats with error handling - continue even if airport data fails
      let uniqueStats;
      try {
        uniqueStats = await calculateUniqueStats(await withDepartureClock(flights), homeHistory);
      } catch (statsError) {
        // If stats calculation fails (e.g., database issues), return partial stats
        logger.error({
          operation: "calculate_unique_stats_error",
          message: "Failed to calculate unique stats, returning partial data",
          error: statsError instanceof Error ? statsError.message : "Unknown error",
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
  }
);

// Airport-focused statistics (top airports, rarest, farthest from home, etc.)
router.get(
  "/airports",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;

      const parsed = DateRangeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
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

      const homeHistory = await loadHomeAirportHistory(userId);

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
  "/records",
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
  }
);

router.get(
  "/passport",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await loadPassport(req.userId!));
    } catch (error) {
      next(error);
    }
  }
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
  "/countries/:code",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const parsed = CountryCodeParamSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid country", details: parsed.error.issues });
        return;
      }

      const detail = await loadCountryDetail(userId, parsed.data.code);

      if (!detail) {
        // Nothing evidences this country — including a code the catalogue does
        // not know. Both are "you have not been there", and saying so is
        // better than an empty page that looks like a loading failure.
        res.status(404).json({ error: "No record of this country" });
        return;
      }

      res.json(detail);
    } catch (error) {
      next(error);
    }
  }
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
  "/wrapped",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const parsed = WrappedQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
        return;
      }

      // One scan, not two: `loadPassport` reads the same countable flights of
      // the same user and is handed these rows (forgejo#49). `arrivalTime` and
      // `arrTimeSemantics` are here only because it needs them.
      const [flights, cruises] = await Promise.all([
        prisma.flight.findMany({
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
            departureTime: true,
            arrivalTime: true,
            depTimeSemantics: true,
            arrTimeSemantics: true,
            airline: true,
            flightNumber: true,
            status: true,
          },
        }),
        prisma.cruise.findMany({
          where: { userId, ...countableFlightWhere() },
          select: { startDate: true, status: true },
        }),
      ]);

      // For `newCountries` only — the passport already decides what counts as
      // a country and when it was first reached.
      const passport = await loadPassport(userId, flights);

      // Which YEAR a flight belongs to is read on the departure airport's
      // clock, not on the stored instant — the rule `departureClock.ts` states
      // and `/stats/timeseries` already follows. Resolved here, at the load,
      // so `buildWrapped` stays a pure function over rows that carry their own
      // answer rather than resolving timezones itself (AUD-077).
      const flightsWithClock = await withDepartureClock(flights);

      const wrapped = buildWrapped(
        // Great-circle from the coordinates, the same measure
        // `/stats/timeseries` buckets — so the year's distance agrees with the
        // year's bar on the trend chart.
        flightsWithClock.map((f) => ({
          ...f,
          departureYear:
            f.departureTime === null
              ? null
              : localWallClockOf(f.departureTime, f.depTimezone, f.depTimeSemantics).year,
          distanceKm: calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon),
        })),
        cruises,
        passport.countries,
        parsed.data.year ?? null
      );

      if (!wrapped) {
        // No countable activity in any year. There is no story, and a grid of
        // zeros would pretend there is one.
        res.status(404).json({ error: "Nothing to look back on yet" });
        return;
      }

      res.json(wrapped);
    } catch (error) {
      next(error);
    }
  }
);

// Seat position statistics
router.get("/seats", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const parsed = DateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
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

    res.json(computeSeatStats(flights));
  } catch (error) {
    next(error);
  }
});

// ─── Airline Ranking ─────────────────────────────────────────────────────────

// GET /api/v1/stats/airlines — loyalty ranking by flight count.
// Scoped to flown + historical like every other aggregate in this file. It used
// to count every row, so a cancelled or still-scheduled booking inflated the
// ranking — and the statistics page put this card a few hundred pixels below
// the client-side breakdown, which has always used the narrower scope. Same
// airline, two numbers, one screen.
router.get(
  "/airlines",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const where: Prisma.FlightWhereInput = { userId, ...countableFlightWhere() };

      const [total, airlineCounts] = await Promise.all([
        prisma.flight.count({ where }),
        prisma.flight.groupBy({
          by: ["airline", "airlineIata", "airlineIcao"],
          where,
          _count: true,
        }),
      ]);

      // The fold lives in `services/stats/airlineRanking.ts`, shared with the
      // composing `GET /stats/page`, which reaches it from the rows it already
      // holds instead of from these two aggregates.
      res.json(
        computeAirlineRanking(
          airlineCounts.map((row) => ({
            airline: row.airline,
            airlineIata: row.airlineIata,
            airlineIcao: row.airlineIcao,
            count: row._count,
          })),
          total
        )
      );
    } catch (error) {
      next(error);
    }
  }
);

// ─── Country Distribution ─────────────────────────────────────────────────────

// GET /api/v1/stats/countries — visited-country distribution (both flight ends)
router.get(
  "/countries",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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

      res.json(await computeCountryStats(flights));
    } catch (error) {
      next(error);
    }
  }
);

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
  "/cruise",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const year = readYearQuery(req.query, res);
      if (year === null) return;

      // One loader for the tab and for the evidence panel — see
      // `services/stats/cruiseStatsData.ts` for why this is not inline.
      const { rows: cruiseRows, userBirthday } = await loadCruiseStatsData(userId, year);
      const cruiseStatsInput: CruiseStatsInput[] = cruiseRows.map((r) => r.input);

      // Defensive parity with the flight stats endpoints: a calculation
      // error on one malformed cruise must not 500 the whole tab — fall
      // back to an empty stats object and log the cause.
      let stats: ReturnType<typeof calculateCruiseStats>;
      try {
        stats = calculateCruiseStats(cruiseStatsInput, userBirthday);
      } catch (calcError) {
        logger.error({
          operation: "cruise_stats_calculation_failed",
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
          [...stats.countriesByYear.entries()].map(([year, set]) => [String(year), isoCodes(set)])
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
  "/lodging",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const year = readYearQuery(req.query, res);
      if (year === null) return;

      // One loader for the tab and for the evidence panel — see
      // `services/stats/lodgingStatsData.ts` for why this is not inline.
      const {
        stays: stayData,
        lodgingRecords,
        baseCurrency,
      } = await loadLodgingStatsData(userId, year);

      // Defensive parity with the cruise/flight stats endpoints: a
      // calculation error on one malformed stay must not 500 the whole
      // tab — fall back to an empty stats object and log the cause.
      let stats: ReturnType<typeof calculateLodgingStats>;
      try {
        stats = calculateLodgingStats(stayData, baseCurrency, lodgingRecords);
      } catch (calcError) {
        logger.error({
          operation: "lodging_stats_calculation_failed",
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
  }
);

// The three aircraft rankings live in `stats/aircraft` — mounted HERE rather
// than at the end of the file so route-matching order is exactly what it was.
router.use(aircraftStatsRouter);

// The composing endpoint (forgejo#49). Mounted on this router so it inherits
// `authenticate` and `statsEtag` above; it answers eleven of this file's
// endpoints from ONE flight scan where the page previously paid thirteen.
router.use(statsPageRouter);

// GET /api/v1/stats/punctuality — actual-vs-scheduled aggregates (#2).
// Reads the stored per-flight delayMinutes captured since 2.5; no new lookups.
router.get(
  "/punctuality",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const parsed = DateRangeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
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
  }
);

/**
 * GET /api/v1/stats/travel-account — the cross-domain night account plus the
 * per-trip rollup.
 *
 * One endpoint for both because a screen that asks "where did I sleep this
 * year" invariably asks "and which trip has a gap" next, and two round-trips
 * for one question is two chances to show half an answer.
 */
router.get(
  "/travel-account",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const data = await loadTravelAccountData(userId);
      const account = buildTravelAccount(data);
      const tripAccount = buildTripAccount(data.trips);

      res.json({ account, trips: tripAccount });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
