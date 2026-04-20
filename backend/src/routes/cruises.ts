import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { createCruiseSchema, updateCruiseSchema, cruiseQuerySchema } from '../schemas/cruise';
import { checkAndUpdateAchievements } from '../utils/achievements';
import { computeSeaRoute } from '../services/seaRouter';
import logger from '../utils/logger';

const router = Router();
router.use(authenticate);

const CRUISE_INCLUDE = {
  ship: true,
  departurePort: true,
  arrivalPort: true,
  stops: { include: { port: true }, orderBy: { dayNumber: 'asc' as const } },
} satisfies Prisma.CruiseInclude;

const requireUser = (req: AuthRequest): string => {
  if (!req.userId) throw new AppError('Not authenticated', 401);
  return req.userId;
};

const buildWhere = (q: Record<string, unknown>, userId: string): Prisma.CruiseWhereInput => {
  const where: Prisma.CruiseWhereInput = { userId };
  if (typeof q.cruiseLine === 'string') where.cruiseLine = q.cruiseLine;
  if (typeof q.status === 'string') where.status = q.status;
  if (typeof q.tripId === 'string') where.tripId = q.tripId;
  if (typeof q.year === 'number') {
    const y = q.year;
    where.startDate = { gte: new Date(`${y}-01-01`), lt: new Date(`${y + 1}-01-01`) };
  }
  if (typeof q.region === 'string') {
    const region = q.region;
    where.OR = [
      { departurePort: { region } },
      { arrivalPort: { region } },
      { stops: { some: { port: { region } } } },
    ];
  }
  return where;
};

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = cruiseQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const where = buildWhere(parsed.data as Record<string, unknown>, userId);
    const cruises = await prisma.cruise.findMany({
      where,
      include: CRUISE_INCLUDE,
      orderBy: { startDate: 'desc' },
      take: parsed.data.limit ?? 500,
      skip: parsed.data.offset ?? 0,
    });
    res.json({ success: true, data: cruises });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const cruise = await prisma.cruise.findFirst({
      where: { id: req.params.id, userId },
      include: CRUISE_INCLUDE,
    });
    if (!cruise) throw new AppError('Cruise not found', 404);
    res.json({ success: true, data: cruise });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/cruises/:id/geometry
 *
 * Returns a GeoJSON FeatureCollection with one LineString per
 * consecutive port pair in the cruise itinerary. Used by the map
 * layer to draw real sea-routes instead of the Bezier placeholder.
 *
 * Stops without a resolved port (sea-days, unplaced stops) are
 * skipped. Legs whose A* run fails (landlocked port, ports on
 * disconnected seas) are silently omitted — the frontend falls back
 * to Bezier for those legs.
 *
 * Phase 1 computes every request; Phase 3 adds the
 * `cruise_route_cache` lookup before A*.
 */
router.get('/:id/geometry', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const cruise = await prisma.cruise.findFirst({
      where: { id: req.params.id, userId },
      include: { stops: { include: { port: true }, orderBy: { dayNumber: 'asc' as const } } },
    });
    if (!cruise) throw new AppError('Cruise not found', 404);

    const ordered = cruise.stops.filter((s) => !s.isAtSea && s.port !== null);

    const features: Array<{
      type: 'Feature';
      geometry: { type: 'LineString'; coordinates: [number, number][] };
      properties: { fromPortId: number; toPortId: number; computed: true };
    }> = [];

    const computedAt = Date.now();
    let computedLegs = 0;
    let skippedLegs = 0;

    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i].port;
      const b = ordered[i + 1].port;
      if (!a || !b) continue;

      const route = await computeSeaRoute(
        { lat: a.lat, lon: a.lon },
        { lat: b.lat, lon: b.lon },
      );
      if (!route) {
        skippedLegs++;
        logger.warn({
          operation: 'cruise_geometry_leg_skip',
          cruiseId: cruise.id,
          fromPortId: a.id,
          toPortId: b.id,
          reason: 'sea_router_returned_null',
        });
        continue;
      }
      features.push({
        type: 'Feature',
        geometry: route,
        properties: { fromPortId: a.id, toPortId: b.id, computed: true },
      });
      computedLegs++;
    }

    logger.info({
      operation: 'cruise_geometry_computed',
      cruiseId: cruise.id,
      userId,
      stops: ordered.length,
      computedLegs,
      skippedLegs,
      durationMs: Date.now() - computedAt,
    });

    res.json({
      success: true,
      data: {
        type: 'FeatureCollection' as const,
        features,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = createCruiseSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const { stops, startDate, endDate, tripId, bookingId, ...rest } = parsed.data;

    const cruise = await prisma.$transaction(async (tx) => {
      const created = await tx.cruise.create({
        data: {
          userId,
          ...rest,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          tripId: tripId ?? null,
          bookingId: bookingId ?? null,
        },
      });

      if (stops && stops.length > 0) {
        await tx.cruiseStop.createMany({
          data: stops.map((s) => ({
            cruiseId: created.id,
            portId: s.portId ?? null,
            dayNumber: s.dayNumber,
            isAtSea: s.isAtSea,
            arrivalTime: s.arrivalTime ? new Date(s.arrivalTime) : null,
            departureTime: s.departureTime ? new Date(s.departureTime) : null,
            excursionNote: s.excursionNote ?? null,
          })),
        });
      }

      return tx.cruise.findUniqueOrThrow({ where: { id: created.id }, include: CRUISE_INCLUDE });
    });

    checkAndUpdateAchievements(userId).catch((err) => {
      logger.error({
        operation: 'cruise_achievement_check_failed',
        error: err instanceof Error ? err.message : err,
      });
    });

    logger.info({ operation: 'cruise_create', cruiseId: cruise.id, userId });
    res.status(201).json({ success: true, data: cruise });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.cruise.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError('Cruise not found', 404);

    const parsed = updateCruiseSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const { stops, startDate, endDate, ...rest } = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.cruise.update({
        where: { id: existing.id },
        data: {
          ...rest,
          startDate:
            startDate === undefined ? undefined : startDate ? new Date(startDate) : null,
          endDate: endDate === undefined ? undefined : endDate ? new Date(endDate) : null,
        },
      });

      if (stops !== undefined) {
        await tx.cruiseStop.deleteMany({ where: { cruiseId: existing.id } });
        if (stops.length > 0) {
          await tx.cruiseStop.createMany({
            data: stops.map((s) => ({
              cruiseId: existing.id,
              portId: s.portId ?? null,
              dayNumber: s.dayNumber,
              isAtSea: s.isAtSea,
              arrivalTime: s.arrivalTime ? new Date(s.arrivalTime) : null,
              departureTime: s.departureTime ? new Date(s.departureTime) : null,
              excursionNote: s.excursionNote ?? null,
            })),
          });
        }
      }

      return tx.cruise.findUniqueOrThrow({ where: { id: existing.id }, include: CRUISE_INCLUDE });
    });

    checkAndUpdateAchievements(userId).catch((err) => {
      logger.error({
        operation: 'cruise_achievement_check_failed',
        error: err instanceof Error ? err.message : err,
      });
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const existing = await prisma.cruise.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError('Cruise not found', 404);
    await prisma.cruise.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
