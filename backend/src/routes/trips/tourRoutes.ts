import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { createRouteSchema, updateRouteSchema } from "../../schemas/tour";
import { drivenKm, travelledKm } from "../../services/tour/tourDistance";
import { resolveTrip } from "../trips";
import logger from "../../utils/logger";

/**
 * Tour route sections — split out of `routes/trips.ts`, which was already
 * 1380 lines against an 800-line maximum. Mounted at the SAME `/trips`
 * prefix as the main trips router, the pattern `routes/cruises/routeOverride.ts`
 * uses alongside `routes/cruises.ts`.
 */

const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

interface LegRow {
  mode: string;
  distanceKm: number;
}

function toDto(
  route: {
    id: string;
    tripId: string;
    name: string;
    mode: string;
    orderIdx: number;
    color: string | null;
    notes: string | null;
    startOdometerKm: number | null;
    endOdometerKm: number | null;
    legs: LegRow[];
    _count: { stops: number };
  },
): Record<string, unknown> {
  return {
    id: route.id,
    tripId: route.tripId,
    name: route.name,
    mode: route.mode,
    orderIdx: route.orderIdx,
    color: route.color,
    notes: route.notes,
    startOdometerKm: route.startOdometerKm,
    endOdometerKm: route.endOdometerKm,
    stopCount: route._count.stops,
    legCount: route.legs.length,
    distanceKm: travelledKm(route.legs),
    drivenKm: drivenKm(route.legs),
  };
}

const ROUTE_SELECT = {
  legs: { select: { mode: true, distanceKm: true } },
  _count: { select: { stops: true } },
} as const;

/** Section must exist AND belong to a trip this user owns. */
async function resolveRoute(userId: string, tripId: string, routeId: string): Promise<string> {
  await resolveTrip(userId, tripId);
  const route = await prisma.tripRoute.findFirst({
    where: { id: routeId, tripId },
    select: { id: true },
  });
  if (!route) throw new AppError("Route not found", 404);
  return route.id;
}

/** GET /trips/:id/routes */
router.get(
  "/trips/:id/routes",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routes = await prisma.tripRoute.findMany({
        where: { tripId: trip.id },
        orderBy: [{ orderIdx: "asc" }, { createdAt: "asc" }],
        include: ROUTE_SELECT,
      });
      res.json({ routes: routes.map(toDto) });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /trips/:id/routes */
router.post(
  "/trips/:id/routes",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const body = createRouteSchema.parse(req.body);

      const last = await prisma.tripRoute.findFirst({
        where: { tripId: trip.id },
        orderBy: { orderIdx: "desc" },
        select: { orderIdx: true },
      });

      const route = await prisma.tripRoute.create({
        data: {
          tripId: trip.id,
          name: body.name,
          mode: body.mode,
          color: body.color,
          notes: body.notes,
          startOdometerKm: body.startOdometerKm,
          endOdometerKm: body.endOdometerKm,
          orderIdx: last ? last.orderIdx + 1 : 0,
        },
        include: ROUTE_SELECT,
      });

      logger.info({ operation: "tour.route.create", routeId: route.id, tripId: trip.id });
      res.status(201).json({ route: toDto(route) });
    } catch (error) {
      next(error);
    }
  },
);

/** PATCH /trips/:id/routes/:routeId */
router.patch(
  "/trips/:id/routes/:routeId",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoute(userId, req.params.id, req.params.routeId);
      const body = updateRouteSchema.parse(req.body);

      const route = await prisma.tripRoute.update({
        where: { id: routeId },
        data: body,
        include: ROUTE_SELECT,
      });
      res.json({ route: toDto(route) });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * DELETE /trips/:id/routes/:routeId
 *
 * Deletes the section and its legs. Its stops are RELEASED, not deleted —
 * `TripStop.routeId` is `onDelete: SetNull`. A tour is scaffolding over the
 * timeline; removing the scaffolding must not remove the timeline.
 */
router.delete(
  "/trips/:id/routes/:routeId",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoute(userId, req.params.id, req.params.routeId);

      await prisma.$transaction(async (tx) => {
        await tx.tripStop.updateMany({
          where: { routeId },
          data: { routeId: null, routeOrderIdx: null },
        });
        await tx.tripRoute.delete({ where: { id: routeId } });
      });

      logger.info({ operation: "tour.route.delete", routeId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
