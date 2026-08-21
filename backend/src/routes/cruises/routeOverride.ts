import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { authenticate, requireWriteScope, AuthRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { routeOverrideSchema, routeOverrideKeySchema } from '../../schemas/cruise';
import { buildEffectivePortSequence } from '../../shared/cruise/portSequence';
import { haversineKm } from '../../shared/geo/haversine';
import { recomputeLegsForCruise } from '../../services/cruiseDistance/cruiseLegService';
import logger from '../../utils/logger';

/**
 * `PUT`/`DELETE /api/v1/cruises/:id/route-override` — split out of
 * `routes/cruises.ts` (which kept everything else) once that file crossed
 * the 800-line hard maximum. Mounted at the SAME prefix as the main cruises
 * router (`/api/v1/cruises`, see `index.ts`) — the same pattern
 * `routes/passwordReset.ts` uses alongside `routes/auth.ts` at
 * `/api/v1/auth`. This is a move, not a rewrite: paths, status codes, check
 * order, transaction boundaries, and logged `operation` fields are all
 * unchanged from before the split.
 */

type PortRow = Prisma.PortGetPayload<Record<string, never>>;

const router = Router();
router.use(authenticate);
// requireWriteScope — same as the main cruises router: a read-only PAT can
// read cruises but never write a route override.
router.use(requireWriteScope);

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError('Not authenticated', 401);
  return req.userId;
};

/**
 * Is `from → to` an actual leg of this cruise's itinerary? Returns the two
 * ports (with their coordinates) if so.
 *
 * Checked on every write. Without it the table accepts lines for legs that do
 * not exist, which can never match anything on read — the user would see a
 * silent no-op instead of an error. The coordinates are what the anchor
 * check below needs — fetched here rather than by a second query.
 */
async function findLegPorts(
  cruiseId: string,
  userId: string,
  fromRef: string,
  toRef: string,
): Promise<{ from: PortRow; to: PortRow } | null> {
  const cruise = await prisma.cruise.findFirst({
    where: { id: cruiseId, userId },
    include: {
      departurePort: true,
      arrivalPort: true,
      stops: {
        where: { isAtSea: false, portId: { not: null } },
        orderBy: { dayNumber: 'asc' },
        include: { port: true },
      },
    },
  });
  if (!cruise) return null;

  const portCalls = cruise.stops
    .filter((s): s is typeof s & { port: NonNullable<typeof s.port> } => s.port !== null)
    .map((s) => s.port);
  const sequence = buildEffectivePortSequence(cruise.departurePort, portCalls, cruise.arrivalPort);

  for (let i = 1; i < sequence.length; i++) {
    if (String(sequence[i - 1].id) === fromRef && String(sequence[i].id) === toRef) {
      return { from: sequence[i - 1], to: sequence[i] };
    }
  }
  return null;
}

// Generous on purpose: coordinate rounding between what the catalogue stores
// and what a client round-trips can be tens of metres, and this only needs
// to catch a line anchored to the wrong sea, not sub-kilometre drift.
const ROUTE_ANCHOR_TOLERANCE_KM = 1;

/**
 * A stored line that doesn't start/end at its leg's ports poisons a
 * persisted statistic silently: `polylineDistanceKm` returns its length as
 * the leg's distance regardless of where it actually goes, so the map shows
 * a detached line AND the kilometres agree with it — worse than the two
 * disagreeing, because nothing looks wrong. Zod cannot check this; it has no
 * database access.
 */
function assertRouteAnchored(
  waypoints: ReadonlyArray<[number, number]>,
  from: PortRow,
  to: PortRow,
): void {
  const [firstLon, firstLat] = waypoints[0];
  const [lastLon, lastLat] = waypoints[waypoints.length - 1];

  const startOffsetKm = haversineKm({ lat: from.lat, lon: from.lon }, { lat: firstLat, lon: firstLon });
  if (startOffsetKm > ROUTE_ANCHOR_TOLERANCE_KM) {
    throw new AppError(
      `Route does not start at the leg's departure port (${startOffsetKm.toFixed(1)} km away)`,
      400,
    );
  }

  const endOffsetKm = haversineKm({ lat: to.lat, lon: to.lon }, { lat: lastLat, lon: lastLon });
  if (endOffsetKm > ROUTE_ANCHOR_TOLERANCE_KM) {
    throw new AppError(
      `Route does not end at the leg's arrival port (${endOffsetKm.toFixed(1)} km away)`,
      400,
    );
  }
}

router.put('/:id/route-override', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = routeOverrideSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const { fromKind, fromRef, toKind, toRef, waypoints } = parsed.data;

    const legPorts = await findLegPorts(req.params.id, userId, fromRef, toRef);
    if (!legPorts) throw new AppError('Cruise or leg not found', 404);
    assertRouteAnchored(waypoints, legPorts.from, legPorts.to);

    const key = { cruiseId: req.params.id, fromKind, fromRef, toKind, toRef };

    // Write and recompute must commit together. `recomputeLegsForCruise`
    // deletes every leg and re-inserts them as two separate statements — a
    // fault between those two would otherwise leave a committed override row
    // next to zero legs: the map still draws the user's line while the
    // statistics silently fall back to inline haversine. Mirrors POST / and
    // PATCH /:id in routes/cruises.ts.
    const { row, replaced } = await prisma.$transaction(async (tx) => {
      const existing = await tx.cruiseLegRoute.findUnique({
        where: { cruiseId_fromKind_fromRef_toKind_toRef: key },
        select: { id: true },
      });

      const row = await tx.cruiseLegRoute.upsert({
        where: { cruiseId_fromKind_fromRef_toKind_toRef: key },
        create: { ...key, waypoints: waypoints as unknown as Prisma.InputJsonValue },
        update: { waypoints: waypoints as unknown as Prisma.InputJsonValue },
      });

      await recomputeLegsForCruise(req.params.id, tx);

      return { row, replaced: existing !== null };
    });

    logger.info({
      operation: 'cruise_route_override_saved',
      cruiseId: req.params.id,
      userId,
      fromRef,
      toRef,
      waypoints: waypoints.length,
      replaced,
    });

    res.status(replaced ? 200 : 201).json({ success: true, data: row });
  } catch (err) {
    next(err);
  }
});

router.delete(
  '/:id/route-override',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      const parsed = routeOverrideKeySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);

      const owned = await prisma.cruise.findFirst({
        where: { id: req.params.id, userId },
        select: { id: true },
      });
      if (!owned) throw new AppError('Cruise not found', 404);

      // Delete and recompute must commit together, same reasoning as the PUT
      // handler above. The recompute only runs when something was actually
      // deleted — clearing an override that was never set (the editor's
      // "automatic again" button on an already-automatic leg) would
      // otherwise delete-and-reinsert every leg and re-run the router for
      // nothing.
      const { count } = await prisma.$transaction(async (tx) => {
        const result = await tx.cruiseLegRoute.deleteMany({
          where: { cruiseId: req.params.id, ...parsed.data },
        });
        if (result.count > 0) {
          await recomputeLegsForCruise(req.params.id, tx);
        }
        return result;
      });

      logger.info({
        operation: 'cruise_route_override_cleared',
        cruiseId: req.params.id,
        userId,
        fromRef: parsed.data.fromRef,
        toRef: parsed.data.toRef,
        deleted: count,
      });

      res.json({ success: true, data: { deleted: count } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
