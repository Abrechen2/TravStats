/**
 * GET /api/v1/stats/network/route/:a/:b — one arc of the globe, in detail
 * (forgejo#132 item 9). The rules are in `services/stats/networkRoute.ts`.
 *
 * Mounted on its own base ahead of the stats router (`routes/mounts.ts`)
 * because `routes/stats.ts` is on the file-size debt list and may not grow.
 * It therefore brings the stats router's two middlewares itself —
 * `authenticate` and the conditional-GET `statsEtag` — so it behaves exactly
 * like its siblings. Bare response, like the rest of `/stats`
 * (docs/adr/0001-api-response-shape.md).
 */

import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { statsEtag } from "../../middleware/statsEtag";
import { countableFlightWhere } from "../../shared/flightCounting";
import {
  networkRouteDetailSchema,
  networkRouteParamsSchema,
  networkRouteQuerySchema,
} from "../../schemas/statsNetworkRoute";
import { getCachedAirports } from "../../services/airportCache";
import type { AirportData } from "../../services/airportLookup";
import { FLIGHT_CLOCK_SELECT, withDepartureClock } from "../../services/stats/departureClock";
import { buildNetworkRouteDetail } from "../../services/stats/networkRoute";
import { airlineResolvers } from "../../utils/airlineNormalize";
import logger from "../../utils/logger";

const router = Router();
router.use(authenticate);
router.use(statsEtag);

router.get("/:a/:b", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const params = networkRouteParamsSchema.safeParse(req.params);
    const query = networkRouteQuerySchema.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({
        error: "Invalid route",
        details: [...(params.error?.issues ?? []), ...(query.error?.issues ?? [])],
      });
      return;
    }

    const flights = await prisma.flight.findMany({
      where: { userId: req.userId!, ...countableFlightWhere() },
      select: {
        id: true,
        flightNumber: true,
        airline: true,
        airlineIata: true,
        airlineIcao: true,
        ...FLIGHT_CLOCK_SELECT,
        depLat: true,
        depLon: true,
        arrLat: true,
        arrLon: true,
        departureTime: true,
        arrivalTime: true,
        status: true,
      },
    });

    // The same catalogue fold `/stats/network` pairs with, and the same
    // degradation when it is unreachable: row codes alone, logged.
    const codes = new Set<string>();
    for (const f of flights) {
      for (const code of [f.depIata ?? f.depIcao, f.arrIata ?? f.arrIcao]) {
        if (code) codes.add(code);
      }
    }
    let catalogue = new Map<string, AirportData>();
    try {
      catalogue = await getCachedAirports([...codes]);
    } catch (error) {
      logger.error({
        operation: "stats_network_route_airport_lookup_failed",
        message: "Airport catalogue unavailable, pairing from flight rows only",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    const detail = buildNetworkRouteDetail(
      await withDepartureClock(flights),
      params.data.a,
      params.data.b,
      catalogue,
      airlineResolvers,
      query.data
    );
    if (!detail) {
      // No counted flight on this pair — the arc does not exist, and an empty
      // sheet would look like a loading failure.
      res.status(404).json({ error: "No flights on this route" });
      return;
    }
    res.json(networkRouteDetailSchema.parse(detail));
  } catch (error) {
    next(error);
  }
});

export default router;
