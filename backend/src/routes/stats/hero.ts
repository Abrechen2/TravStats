/**
 * `GET /stats/hero` — the Companion's Start-board hero tile.
 *
 * Split out of `routes/stats.ts` (frozen by the size ratchet) when it gained
 * `?year=` (companion-redesign C4), mounted from there at the position it used
 * to occupy.
 */

import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { Prisma } from "../../prisma";
import { calculateFunStats, calculateAirportStats } from "../../utils/statsCalculator";
import { FLIGHT_CLOCK_SELECT, withDepartureClock } from "../../services/stats/departureClock";
import { loadPassport } from "../../services/stats/passportLoader";
import { buildWhere, computeSummary } from "../../services/stats/summary";
import { countableFlightWhere } from "../../shared/flightCounting";
import { getBaseCurrency } from "../../services/fx/snapshot";
import { readYearQuery, statsScope } from "../../utils/stats/domainYear";

const router = Router();

/** The flight ids `buildWhere` pinned a year to (`id: { in: [...] }`). */
function yearIdsOf(where: Prisma.FlightWhereInput): string[] {
  const id = where.id;
  return typeof id === "object" && id !== null && "in" in id && Array.isArray(id.in) ? id.in : [];
}

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
// instead of duplicating their queries. `?year=` scopes every figure to that
// local calendar year. The airport+fun flight select is fetched ONCE and
// shared between calculateAirportStats and calculateFunStats since both use
// the identical select already used by /airports and /fun.
router.get("/hero", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const year = readYearQuery(req.query, res);
    if (year === null) return;

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
    const yearWhere = await buildWhere(userId, undefined, undefined, year);
    const [{ stats: summary }, flights] = await Promise.all([
      computeSummary(yearWhere, baseCurrency),
      prisma.flight.findMany({
        where: flightsWhere,
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
    // The passport gets EVERY countable flight even under a year: it grades a
    // trip over New Year on all its legs before cutting the evidence by day.
    const passport = await loadPassport(userId, flights, {}, { year });
    const yearIds = year === undefined ? null : new Set(yearIdsOf(yearWhere));
    const datedFlights = await withDepartureClock(
      yearIds === null ? flights : flights.filter((f) => yearIds.has(f.id))
    );

    // No home periods, deliberately: this endpoint only reads
    // airportCount, which doesn't depend on home — only the
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

    res.json({ ...hero, scope: statsScope(year) });
  } catch (error) {
    next(error);
  }
});

export default router;
