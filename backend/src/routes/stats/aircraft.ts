/**
 * The three aircraft rankings of /api/v1/stats.
 *
 * Split out of `routes/stats.ts` on 2026-09-15, which had grown 130 lines past
 * its frozen size. Of the twenty-odd endpoints in that router these three are
 * the one group that answers a single question — what did the user fly IN —
 * and the only ones that care about tail numbers at all.
 *
 * Mounted from `stats.ts` at exactly the position the routes used to occupy,
 * so Express matches in the same order as before. Bare responses, like the
 * rest of that router (docs/adr/0001-api-response-shape.md).
 */

import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { countableFlightWhere } from "../../shared/flightCounting";
// The response shapes live in `schemas/statsAircraft` and this file infers
// from them, so the spec and the handler cannot describe different things
// (forgejo#52).
import type {
  AircraftTypeItem,
  AircraftTypesResponse,
  AircraftProfileResponse,
  AircraftProfileFlight,
} from "../../schemas/statsAircraft";
import { calculateDistance } from "../../utils/geo";
import { computeAircraftRanking } from "../../services/stats/aircraftRanking";

const router = Router();

// ─── Aircraft type ranking ──────────────────────────────────────────────────

// GET /api/v1/stats/aircraft-types — ranking by aircraft TYPE ("Airbus A320neo").
// Distinct from /stats/aircraft, which ranks tail numbers and only sees
// registration-bearing (AeroDataBox-enriched) rows. `total` is the user's total
// flight count so this shares a denominator with /stats/airlines — and
// therefore that endpoint's flown + historical scope; flights with no
// `aircraft` value produce no row, so percentages need not sum to 100.
router.get(
  "/aircraft-types",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const where: Prisma.FlightWhereInput = { userId, ...countableFlightWhere() };

      const [total, typeCounts] = await Promise.all([
        prisma.flight.count({ where }),
        prisma.flight.groupBy({
          by: ["aircraft"],
          where: { ...where, aircraft: { not: null } },
          _count: true,
        }),
      ]);

      const aircraftTypes: AircraftTypeItem[] = typeCounts
        .map((row) => ({
          aircraft: row.aircraft!,
          count: row._count,
          percentage: total > 0 ? Math.round((row._count / total) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.count - a.count);

      const response: AircraftTypesResponse = { aircraftTypes, total };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

// ─── Aircraft (tail number) ─────────────────────────────────────────────────

// GET /api/v1/stats/aircraft — top tail numbers ("Hulls" tab).
// Excludes flights without registration so the ranking only reflects
// AeroDataBox-enriched rows. The per-user index on
// (user_id, aircraft_registration) makes this cheap.
router.get(
  "/aircraft",
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

      // The fold lives in `services/stats/aircraftRanking.ts`, shared with the
      // composing `GET /stats/page` (forgejo#49) — which reaches it from the
      // countable rows it already holds, this route's predicate being a subset.
      res.json(computeAircraftRanking(flights));
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/stats/aircraft/:registration — per-tail profile.
// Returns aggregate stats plus the user's flights on that hull, newest
// first. 404 if the user has no flights with that registration.
router.get(
  "/aircraft/:registration",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const registration = req.params["registration"];
      if (!registration || registration.length > 20) {
        res.status(400).json({ error: "Invalid registration" });
        return;
      }
      // The ranking that leads here already counts with the shared filter
      // (`countableFlightWhere` a few hundred lines up). This query did not, so
      // walking from the list into the detail grew the flight count and the
      // distance without a single further flight actually having been flown —
      // a cancelled leg and a 2099 booking were being added to "already flown"
      // figures, and the page has no status column to reveal it (AUD-078).
      // Parity with the ranking is the whole point: same population, same
      // numbers.
      const flights = await prisma.flight.findMany({
        where: { userId, ...countableFlightWhere(), aircraftRegistration: registration },
        orderBy: { departureTime: "desc" },
      });

      if (flights.length === 0) {
        res.status(404).json({ error: "NO_FLIGHTS_FOR_AIRCRAFT" });
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
  }
);

export default router;
