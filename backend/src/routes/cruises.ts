import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { createCruiseSchema, updateCruiseSchema, cruiseQuerySchema } from '../schemas/cruise';
import { checkAndUpdateAchievements } from '../utils/achievements';
import { computeSchematicRoute } from '../services/schematicRouter';
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
 * consecutive port pair in the cruise itinerary. Each LineString is
 * the 3-8 waypoint output of the schematic coarse router, which the
 * frontend splines into a smooth continental-detour curve.
 *
 * Stops without a resolved port (sea-days, unplaced stops) are
 * skipped. `routed: false` (ports on disconnected seas) legs still
 * produce a 2-vertex direct-chord feature — the frontend renders it
 * identically to a routed one so the map is never visually broken.
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
      properties: {
        fromPortId: number;
        toPortId: number;
        routed: boolean;
      };
    }> = [];

    const computedAt = Date.now();
    let routedLegs = 0;
    let directLegs = 0;

    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i].port;
      const b = ordered[i + 1].port;
      if (!a || !b) continue;

      const route = await computeSchematicRoute(
        {
          id: a.id,
          name: a.name,
          city: a.city,
          country: a.country,
          unlocode: a.unlocode,
          lat: a.lat,
          lon: a.lon,
        },
        {
          id: b.id,
          name: b.name,
          city: b.city,
          country: b.country,
          unlocode: b.unlocode,
          lat: b.lat,
          lon: b.lon,
        },
      );
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: route.waypoints },
        properties: {
          fromPortId: a.id,
          toPortId: b.id,
          routed: route.routed,
        },
      });
      if (route.routed) routedLegs++;
      else directLegs++;
    }

    logger.info({
      operation: 'cruise_geometry_computed',
      cruiseId: cruise.id,
      userId,
      stops: ordered.length,
      routedLegs,
      directLegs,
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
