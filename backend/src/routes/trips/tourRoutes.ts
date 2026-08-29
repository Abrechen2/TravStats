import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { assignStopsSchema, createRouteSchema, updateRouteSchema } from "../../schemas/tour";
import { drivenKm, legDistanceKm, travelledKm, type LegSource } from "../../services/tour/tourDistance";
import { planLegs } from "../../shared/tour/legPlan";
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

export function toLegDto(leg: {
  id: string;
  fromStopId: string;
  toStopId: string;
  distanceKm: number;
  source: string;
  mode: string;
  confidence: string;
  waypoints: Prisma.JsonValue | null;
  drivingMinutes: number | null;
  tollCost: number | null;
  currency: string | null;
}): Record<string, unknown> {
  return {
    id: leg.id,
    fromStopId: leg.fromStopId,
    toStopId: leg.toStopId,
    distanceKm: leg.distanceKm,
    source: leg.source,
    mode: leg.mode,
    confidence: leg.confidence,
    waypoints: leg.waypoints ?? null,
    drivingMinutes: leg.drivingMinutes,
    tollCost: leg.tollCost,
    currency: leg.currency,
  };
}

const ROUTE_SELECT = {
  legs: { select: { mode: true, distanceKm: true } },
  _count: { select: { stops: true } },
} as const;

/** Section must exist AND belong to a trip this user owns. */
export async function resolveRoute(userId: string, tripId: string, routeId: string): Promise<string> {
  await resolveTrip(userId, tripId);
  const route = await prisma.tripRoute.findFirst({
    where: { id: routeId, tripId },
    select: { id: true },
  });
  if (!route) throw new AppError("Route not found", 404);
  return route.id;
}

type Tx = Prisma.TransactionClient;

interface StopCoords {
  id: string;
  lat: number | null;
  lon: number | null;
}

/**
 * Bring a section's legs in line with its stop order, inside an existing
 * transaction.
 *
 * Legs whose endpoint pair survives keep their row — geometry, source and
 * manual costs included. Pairs that vanished are deleted; new pairs start
 * as `straight`. Nothing here consults the previous ORDER, only the pairs,
 * which is what makes an insertion cheap.
 */
async function recomputeLegs(
  tx: Tx,
  routeId: string,
  defaultMode: string,
  orderedStops: readonly StopCoords[],
): Promise<void> {
  const existing = await tx.tripRouteLeg.findMany({
    where: { routeId },
    select: { id: true, fromStopId: true, toStopId: true },
  });

  const plan = planLegs(
    orderedStops.map((s) => s.id),
    existing,
  );

  if (plan.deleteIds.length > 0) {
    await tx.tripRouteLeg.deleteMany({ where: { id: { in: plan.deleteIds } } });
  }

  // Built as a plain array and written with ONE createMany, not one create
  // per pair: at the 512-stop cap this is up to 511 rows, and awaiting them
  // one at a time inside an interactive transaction risks the 5s Prisma
  // default (raised below, but there is no reason to spend the budget on
  // round-trips the distances don't need — they're already computed in JS).
  const byId = new Map(orderedStops.map((s) => [s.id, s]));
  const rows: Prisma.TripRouteLegCreateManyInput[] = plan.create.map((pair) => {
    const from = byId.get(pair.fromStopId);
    const to = byId.get(pair.toStopId);
    // Guarded by the caller, which rejects coordinate-less stops before
    // reaching here; the check keeps the invariant local and typed.
    if (!from || !to || from.lat === null || from.lon === null || to.lat === null || to.lon === null) {
      throw new AppError("Every route stop needs a coordinate", 400);
    }
    return {
      routeId,
      fromStopId: pair.fromStopId,
      toStopId: pair.toStopId,
      source: "straight" satisfies LegSource,
      mode: defaultMode,
      confidence: "low",
      distanceKm: legDistanceKm({
        source: "straight",
        from: { lat: from.lat, lon: from.lon },
        to: { lat: to.lat, lon: to.lon },
      }),
    };
  });
  if (rows.length > 0) {
    await tx.tripRouteLeg.createMany({ data: rows });
  }
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

/**
 * PUT /trips/:id/routes/:routeId/stops
 *
 * The complete ordered stop list of one section, replacing whatever was
 * there. This is the ONLY writer of `routeOrderIdx`, which is why the
 * broken global `TripStop.orderIdx` (never sent by any client, therefore
 * always 0) does not affect route ordering.
 *
 * Everything happens in one transaction: release, assign, renumber,
 * recompute. A half-applied assignment would leave legs pointing at stops
 * that are no longer in the section.
 *
 * A stop already belonging to a DIFFERENT section is rejected up front —
 * releasing it here would silently steal it from its current section and
 * leave that section's legs pointing at a stop that has moved out from
 * under them, with no recompute ever triggered for it. That pre-check
 * reads on the plain client before the transaction opens, so it is
 * check-then-act and can itself lose a race between two concurrent PUTs;
 * the actual write inside the transaction re-checks ownership and rolls
 * back with 409 if it lost (see the loop below). `routeId` and
 * `routeOrderIdx` are always written together (release: both to null,
 * assign: both set) because `@@unique([routeId, routeOrderIdx])` is
 * skipped by Postgres whenever either column is null — a half-state would
 * not collide and would not be caught by the schema.
 */
router.put(
  "/trips/:id/routes/:routeId/stops",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);
      const { stopIds } = assignStopsSchema.parse(req.body);

      // No de-dup needed here: `assignStopsSchema` already rejects a
      // repeated stop id (see the loop-modelling note on that schema).
      const stops = await prisma.tripStop.findMany({
        where: { id: { in: stopIds }, tripId: trip.id },
        select: { id: true, lat: true, lon: true, title: true, routeId: true },
      });

      if (stops.length !== stopIds.length) {
        throw new AppError("Every stop must belong to this trip", 400);
      }
      const missing = stops.find((s) => s.lat === null || s.lon === null);
      if (missing) {
        throw new AppError(
          `Every route stop needs a coordinate — "${missing.title}" has none`,
          400,
        );
      }
      const stolen = stops.find((s) => s.routeId !== null && s.routeId !== routeId);
      if (stolen) {
        throw new AppError(
          `Stop "${stolen.title}" already belongs to another route section`,
          400,
        );
      }

      const byId = new Map(stops.map((s) => [s.id, s]));
      // `stopIds` is unique by schema (a loop is two distinct stops at the
      // same coordinates, never one id twice) — see `assignStopsSchema` —
      // so its index IS the final `routeOrderIdx`, contiguous from 0.
      const ordered = stopIds.map((id) => byId.get(id)!);

      await prisma.$transaction(
        async (tx) => {
          // Release first: `@@unique([routeId, routeOrderIdx])` would
          // collide with the old numbering otherwise.
          await tx.tripStop.updateMany({
            where: { routeId },
            data: { routeId: null, routeOrderIdx: null },
          });
          // The pre-check above (decision 1) is check-then-act and can lose
          // a race: a concurrent PUT on a sibling section could assign the
          // same stop between that read and this write. So the write is
          // ALSO self-guarding: it only succeeds if the row is still free
          // or already ours. If a concurrent writer won the stop first,
          // `count` comes back 0 and the whole transaction rolls back —
          // nothing partially applied, and the caller finds out (409)
          // instead of silently losing a leg's endpoint.
          for (let idx = 0; idx < stopIds.length; idx++) {
            const id = stopIds[idx];
            const hit = await tx.tripStop.updateMany({
              where: { id, tripId: trip.id, OR: [{ routeId: null }, { routeId }] },
              data: { routeId, routeOrderIdx: idx },
            });
            if (hit.count !== 1) {
              throw new AppError("A stop changed section while this request was in flight", 409);
            }
          }
          const route = await tx.tripRoute.findUniqueOrThrow({
            where: { id: routeId },
            select: { mode: true },
          });
          await recomputeLegs(tx, routeId, route.mode, ordered);
        },
        // Default interactive-transaction timeout is 5000ms. At the
        // 512-stop cap this loop is up to 512 awaited updates; comfortably
        // inside 20s even over a non-local socket.
        { timeout: 20_000 },
      );

      const [route, legs, savedStops] = await Promise.all([
        prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId }, include: ROUTE_SELECT }),
        prisma.tripRouteLeg.findMany({
          where: { routeId },
          orderBy: { fromStop: { routeOrderIdx: "asc" } },
        }),
        prisma.tripStop.findMany({
          where: { routeId },
          orderBy: { routeOrderIdx: "asc" },
          select: { id: true, title: true, lat: true, lon: true, routeOrderIdx: true },
        }),
      ]);

      logger.info({ operation: "tour.stops.assign", routeId, stopCount: stopIds.length });
      res.json({ route: toDto(route), stops: savedStops, legs: legs.map(toLegDto) });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
