import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { stationAppendLimiter } from "../../middleware/rateLimit";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import {
  appendStation,
  dayContext,
  findActiveRoadtrip,
  removeStation,
} from "../../services/roadtrip/companionStations";
import { AppError } from "../../middleware/errorHandler";
import { resolveRoadtrip } from "../../services/roadtrip/resolveRoadtrip";
import { STATION_DTO_SELECT, toStationDto } from "../../services/roadtrip/roadtripSummary";
import { foldViaPoints } from "../../shared/tour/viaPoints";
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

/** `lodgingStayId` exactly when the night is a stay (forgejo#132 item 2). */
export const appendSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    date: isoDay,
    night: z.enum(["pass", "free", "stay"]),
    lodgingStayId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((b) => (b.night === "stay") === (b.lodgingStayId !== undefined), {
    message: 'lodgingStayId is required with night "stay" and allowed only with it',
    path: ["lodgingStayId"],
  });

const stationParams = z.object({ id: z.string().min(1), stationId: z.string().uuid() });

async function stationsAndLegs(routeId: string) {
  const [stations, legs] = await Promise.all([
    prisma.tripStop.findMany({
      where: { routeId },
      orderBy: { routeOrderIdx: "asc" },
      select: STATION_DTO_SELECT,
    }),
    prisma.tripRouteLeg.findMany({
      where: { routeId },
      orderBy: { fromStop: { routeOrderIdx: "asc" } },
    }),
  ]);
  // The phone lists stations: route corrections are folded out and the legs
  // through them merged, so it sees A → B with the line still bent.
  const folded = foldViaPoints(stations, legs);
  return { stations: folded.stations.map(toStationDto), legs: folded.legs.map(toLegDto) };
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
  stationAppendLimiter,
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

/**
 * DELETE /roadtrips/:id/stations/:stationId — take ONE station off, the
 * phone's undo after an append (forgejo#132 item 1). A station of another
 * roadtrip or account is a 404, as is an id that is not a uuid.
 */
router.delete(
  "/roadtrips/:id/stations/:stationId",
  authenticate,
  stationAppendLimiter,
  requireWriteScope,
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const params = stationParams.safeParse(req.params);
      if (!params.success) throw new AppError("Station not found", 404);
      const routeId = await resolveRoadtrip(userId, params.data.id);
      const { released } = await removeStation(userId, routeId, params.data.stationId);
      const { stations, legs } = await stationsAndLegs(routeId);
      logger.info({ operation: "roadtrip.stations.remove", routeId, released });
      res.json({ removed: { id: params.data.stationId, released }, stations, legs });
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
