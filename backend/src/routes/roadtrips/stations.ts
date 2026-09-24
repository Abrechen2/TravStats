import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { stationsSchema, type StationsInput } from "../../schemas/roadtrip";
import { recomputeLegs, type StopCoords } from "../../services/tour/legRecompute";
import { STATION_SELECT, nightsOf, toStationDto } from "../../services/roadtrip/roadtripSummary";
import { toDto, toLegDto, readRouteAndLegs, ROUTE_SELECT } from "../trips/tourRoutes";
import { autoRouteNewLegs } from "../../services/tour/routing/autoRouteLegs";
import logger from "../../utils/logger";
import { resolveRoadtrip } from "../../services/roadtrip/resolveRoadtrip";

const router = Router();

type Station = StationsInput["stations"][number];

/** The two columns a station's night is stored in — see `TripStop.overnight`. */
function nightColumns(station: Station): { lodgingStayId: string | null; overnight: boolean } {
  switch (station.night.kind) {
    case "stay":
      return { lodgingStayId: station.night.lodgingStayId, overnight: true };
    case "free":
      return { lodgingStayId: null, overnight: true };
    case "pass":
      return { lodgingStayId: null, overnight: false };
  }
}

/**
 * Every linked stay must be the caller's. A foreign key proves the stay
 * exists, not whose it is — without this, a station could point at another
 * user's stay and read its name, dates and price class back through the
 * detail call.
 */
async function assertStaysOwned(userId: string, stations: readonly Station[]): Promise<void> {
  const ids = [
    ...new Set(stations.flatMap((s) => (s.night.kind === "stay" ? [s.night.lodgingStayId] : []))),
  ];
  if (ids.length === 0) return;
  const owned = await prisma.lodgingStay.count({ where: { id: { in: ids }, userId } });
  if (owned !== ids.length) throw new AppError("Stay not found", 404);
}

/**
 * PUT /roadtrips/:id/stations
 *
 * The complete, ordered station list — added, moved, removed, renumbered and
 * re-linked in one write, the same all-or-nothing shape as a standalone
 * tour's `/points`. Legs are recomputed in the same transaction and keyed by
 * endpoint station, so a hand-drawn or routed leg survives an unrelated
 * insertion.
 *
 * A station that existed on a trip's timeline before the 2.7 classification
 * (a trip section that became a roadtrip) keeps its `tripId`; a new station
 * is owned by the roadtrip alone. Removing a timeline stop from the list
 * releases it back to the timeline rather than deleting it — the trip's
 * timeline is not the roadtrip's to destroy.
 */
router.put(
  "/roadtrips/:id/stations",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoadtrip(userId, req.params.id);
      const { stations } = stationsSchema.parse(req.body);

      const givenIds = stations.flatMap((s) => (s.id === undefined ? [] : [s.id]));
      if (new Set(givenIds).size !== givenIds.length) {
        throw new AppError("A station may appear once — a return visit is its own station", 400);
      }
      await assertStaysOwned(userId, stations);

      const mode = (
        await prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId }, select: { mode: true } })
      ).mode;

      const result = await prisma.$transaction(
        async (tx) => {
          const existing = await tx.tripStop.findMany({
            where: { routeId },
            select: { id: true },
          });
          const known = new Set(existing.map((s) => s.id));
          const unknown = givenIds.find((id) => !known.has(id));
          if (unknown !== undefined) {
            throw new AppError("A station id does not belong to this roadtrip", 400);
          }

          // Free every position first: `@@unique([routeId, routeOrderIdx])`
          // would otherwise collide mid-reorder.
          await tx.tripStop.updateMany({ where: { routeId }, data: { routeOrderIdx: null } });

          const ordered: StopCoords[] = [];
          for (const [index, station] of stations.entries()) {
            const data = {
              title: station.title,
              lat: station.lat,
              lon: station.lon,
              startDate: station.startDate ?? null,
              endDate: station.endDate ?? null,
              notes: station.notes ?? null,
              ...nightColumns(station),
              routeId,
              routeOrderIdx: index,
            };
            const row =
              station.id === undefined
                ? await tx.tripStop.create({
                    data: { ...data, tripId: null, domain: "roadtrip" },
                    select: { id: true, lat: true, lon: true },
                  })
                : await tx.tripStop.update({
                    where: { id: station.id },
                    data,
                    select: { id: true, lat: true, lon: true },
                  });
            ordered.push(row);
          }

          // Dropped stations: a timeline stop goes back to its trip, a
          // roadtrip-owned one is deleted with its legs.
          await tx.tripStop.updateMany({
            where: { routeId, routeOrderIdx: null, tripId: { not: null } },
            data: { routeId: null, lodgingStayId: null, overnight: false },
          });
          await tx.tripStop.deleteMany({ where: { routeId, routeOrderIdx: null } });

          const createdLegs = await recomputeLegs(tx, routeId, mode, ordered);

          return {
            createdLegs,
            route: await tx.tripRoute.findUniqueOrThrow({
              where: { id: routeId },
              include: ROUTE_SELECT,
            }),
            stations: await tx.tripStop.findMany({
              where: { routeId },
              orderBy: { routeOrderIdx: "asc" },
              select: STATION_SELECT,
            }),
            legs: await tx.tripRouteLeg.findMany({
              where: { routeId },
              orderBy: { fromStop: { routeOrderIdx: "asc" } },
            }),
          };
        },
        { timeout: 20_000 }
      );

      const routedCount = await autoRouteNewLegs(userId, routeId, result.createdLegs);
      const { route, legs } = routedCount > 0 ? await readRouteAndLegs(routeId) : result;

      logger.info({ operation: "roadtrip.stations.replace", routeId, count: stations.length });
      res.json({
        roadtrip: toDto(route),
        nights: nightsOf(result.stations),
        stations: result.stations.map(toStationDto),
        legs: legs.map(toLegDto),
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
