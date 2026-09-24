import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import {
  appendStation,
  dayContext,
  findActiveRoadtrip,
} from "../../services/roadtrip/companionStations";
import { resolveRoadtrip } from "../../services/roadtrip/resolveRoadtrip";
import { STATION_SELECT, toStationDto } from "../../services/roadtrip/roadtripSummary";
import logger from "../../utils/logger";
import { toDto, toLegDto, ROUTE_SELECT } from "../trips/tourRoutes";

/**
 * The phone's endpoints for roadtrips (companion#12, #13; owner 2026-09-24):
 * the roadtrip running today, one station appended where the phone stands,
 * and which trip or station a day belongs to. Mounted BEFORE the roadtrip
 * router's `/roadtrips/:id`, which would otherwise take "active" for an id.
 * Bare response family, like the rest of the roadtrip routes.
 */

const router = Router();

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const dayQuery = z.object({ date: isoDay });

const appendSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    date: isoDay,
    night: z.enum(["pass", "free"]),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

async function stationsAndLegs(routeId: string) {
  const [stations, legs] = await Promise.all([
    prisma.tripStop.findMany({
      where: { routeId },
      orderBy: { routeOrderIdx: "asc" },
      select: STATION_SELECT,
    }),
    prisma.tripRouteLeg.findMany({
      where: { routeId },
      orderBy: { fromStop: { routeOrderIdx: "asc" } },
    }),
  ]);
  return { stations: stations.map(toStationDto), legs: legs.map(toLegDto) };
}

/** GET /roadtrips/active?date=YYYY-MM-DD — the roadtrip running on the phone's local date. */
router.get(
  "/roadtrips/active",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { date } = dayQuery.parse(req.query);
      const active = await findActiveRoadtrip(req.userId!, date);
      if (!active) {
        res.json({ roadtrip: null, stations: [], todayStationId: null });
        return;
      }
      const route = await prisma.tripRoute.findUniqueOrThrow({
        where: { id: active.routeId },
        include: ROUTE_SELECT,
      });
      res.json({
        roadtrip: toDto(route),
        stations: active.stations.map(toStationDto),
        todayStationId: active.todayStationId,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /roadtrips/:id/stations — append ONE station where the phone stands.
 * 201 when it was added, 200 when it was already there (a resend).
 */
router.post(
  "/roadtrips/:id/stations",
  authenticate,
  requireWriteScope,
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoadtrip(userId, req.params.id);
      const input = appendSchema.parse(req.body);
      const { stationId, created } = await appendStation(userId, routeId, input);
      const { stations, legs } = await stationsAndLegs(routeId);
      logger.info({ operation: "roadtrip.stations.append", routeId, created });
      res.status(created ? 201 : 200).json({
        station: stations.find((s) => s.id === stationId),
        stations,
        legs,
      });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /day-context?date=YYYY-MM-DD — the trip and roadtrip station a day belongs to. */
router.get(
  "/day-context",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { date } = dayQuery.parse(req.query);
      res.json(await dayContext(req.userId!, date));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
