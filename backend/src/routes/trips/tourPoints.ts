import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { tourPointsSchema } from "../../schemas/tour";
import { recomputeLegs, type StopCoords } from "../../services/tour/legRecompute";
import logger from "../../utils/logger";
import { resolveRoute, toDto, toLegDto, readRouteAndLegs, ROUTE_SELECT } from "./tourRoutes";
import { autoRouteNewLegs } from "../../services/tour/routing/autoRouteLegs";

/**
 * The point list of a STANDALONE tour — one that belongs to no trip.
 *
 * A section of a trip draws its vertices from that trip's timeline
 * (`PUT /trips/:id/routes/:routeId/stops` assigns existing stops). A
 * standalone tour has no timeline to draw from, so its points are authored
 * here: the body carries the complete, ordered list, and this replaces what
 * the tour had — added, moved, removed and renumbered in one write.
 *
 * All-or-nothing, like the assign endpoint, and for the same reason: a
 * half-applied list leaves legs pointing at points that are no longer in
 * the tour.
 *
 * It refuses a tour that HAS a trip, rather than quietly doing something
 * reasonable. Those two tours are edited in two different ways on purpose,
 * and a request that reaches the wrong one is a client bug worth hearing
 * about — silently creating a second, trip-less copy of a stop that already
 * exists on the timeline is exactly the duplicate this split avoids.
 */
const router = Router();

router.put(
  "/tours/:routeId/points",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoute(userId, undefined, req.params.routeId);
      const { points } = tourPointsSchema.parse(req.body);

      const section = await prisma.tripRoute.findUniqueOrThrow({
        where: { id: routeId },
        select: { tripId: true, mode: true },
      });
      if (section.tripId !== null) {
        throw new AppError(
          "This tour belongs to a trip — assign its stops through the trip instead",
          409
        );
      }

      const givenIds = points.flatMap((p) => (p.id === undefined ? [] : [p.id]));
      if (new Set(givenIds).size !== givenIds.length) {
        throw new AppError("A point may appear once — a loop is two points at one place", 400);
      }

      const saved = await prisma.$transaction(
        async (tx) => {
          // Every id the body names must already be a point of THIS tour.
          // Without this an id from a stranger's tour would be adopted by
          // the update below, which filters on the id alone.
          const existing = await tx.tripStop.findMany({
            where: { routeId },
            select: { id: true },
          });
          const known = new Set(existing.map((s) => s.id));
          const unknown = givenIds.find((id) => !known.has(id));
          if (unknown !== undefined) {
            throw new AppError("A point id does not belong to this tour", 400);
          }

          // Clear the NUMBERING before writing the new one, or
          // `@@unique([routeId, routeOrderIdx])` collides with the old
          // positions. Only the index: Postgres skips that unique where
          // either column is null, so clearing one is enough — and
          // clearing `routeId` too would momentarily leave these points
          // attached to nothing, which `trip_stops_trip_or_route` refuses
          // outright.
          await tx.tripStop.updateMany({
            where: { routeId },
            data: { routeOrderIdx: null },
          });

          const ordered: StopCoords[] = [];
          for (const [index, point] of points.entries()) {
            if (point.id === undefined) {
              const created = await tx.tripStop.create({
                data: {
                  // No trip: this point exists only as a vertex of this
                  // tour, which is what `trip_stops_trip_or_route` allows
                  // and what the tour's own owner accounts for.
                  tripId: null,
                  title: point.title,
                  lat: point.lat,
                  lon: point.lon,
                  routeId,
                  routeOrderIdx: index,
                },
                select: { id: true, lat: true, lon: true },
              });
              ordered.push(created);
              continue;
            }
            const updated = await tx.tripStop.update({
              where: { id: point.id },
              data: {
                title: point.title,
                lat: point.lat,
                lon: point.lon,
                routeId,
                routeOrderIdx: index,
              },
              select: { id: true, lat: true, lon: true },
            });
            ordered.push(updated);
          }

          // Whatever the new list left behind: still on this tour, but
          // with no position, because every point the list DID name was
          // renumbered above. A point nobody placed is a point the reader
          // removed.
          await tx.tripStop.deleteMany({ where: { routeId, routeOrderIdx: null } });

          const createdLegs = await recomputeLegs(tx, routeId, section.mode, ordered);

          return {
            createdLegs,
            route: await tx.tripRoute.findUniqueOrThrow({
              where: { id: routeId },
              include: ROUTE_SELECT,
            }),
            stops: await tx.tripStop.findMany({
              where: { routeId },
              orderBy: { routeOrderIdx: "asc" },
              select: { id: true, title: true, lat: true, lon: true, routeOrderIdx: true },
            }),
            legs: await tx.tripRouteLeg.findMany({
              where: { routeId },
              orderBy: { fromStop: { routeOrderIdx: "asc" } },
            }),
          };
        },
        // The assign endpoint raises this for the same reason: a long list
        // is one round trip per point, and the default 5000ms is not a
        // budget anyone measured.
        { timeout: 20_000 }
      );

      logger.info({ operation: "tour.points.replace", routeId, count: points.length });
      const routedCount = await autoRouteNewLegs(userId, routeId, saved.createdLegs);
      const { route, legs } = routedCount > 0 ? await readRouteAndLegs(routeId) : saved;
      res.json({ route: toDto(route), stops: saved.stops, legs: legs.map(toLegDto) });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
