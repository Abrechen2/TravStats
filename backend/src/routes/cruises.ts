import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { createCruiseSchema, updateCruiseSchema, cruiseQuerySchema } from '../schemas/cruise';
import { checkAndUpdateAchievements } from '../utils/achievements';
import { buildEffectivePortSequence } from '../shared/cruise/portSequence';
import { computeSchematicRoute } from '../services/schematicRouter';
import { recomputeLegsForCruise } from '../services/cruiseDistance/cruiseLegService';
import logger from '../utils/logger';

interface GeometryFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: {
    fromPortId: number;
    toPortId: number;
    routed: boolean;
    protectedPrefixCount: number;
    protectedSuffixCount: number;
    method: 'short_hop' | 'maritime_graph' | 'coarse_a_star' | 'direct';
  };
}

interface GeometryFeatureCollection {
  type: 'FeatureCollection';
  features: GeometryFeature[];
}

type CruiseStopWithPort = Prisma.CruiseStopGetPayload<{ include: { port: true } }>;
type PortRow = Prisma.PortGetPayload<Record<string, never>>;

interface CruiseGeometryInput {
  stops: CruiseStopWithPort[];
  departurePort: PortRow | null;
  arrivalPort: PortRow | null;
}

/**
 * Compute the GeoJSON FeatureCollection for one cruise's itinerary.
 * The route covers departure port → port-call stops → arrival port;
 * each consecutive port-pair becomes one LineString. Sea-day and
 * unmatched stops are skipped — they don't contribute legs. The
 * underlying `computeSchematicRoute` is cached, so calling this in a
 * batch over the same set of port-pairs is essentially free after the
 * first miss.
 */
async function buildCruiseGeometry(
  cruise: CruiseGeometryInput,
): Promise<{ collection: GeometryFeatureCollection; routedLegs: number; directLegs: number }> {
  const portCalls = cruise.stops
    .filter((s) => !s.isAtSea && s.port !== null)
    .map((s) => s.port as PortRow);
  const ordered = buildEffectivePortSequence(cruise.departurePort, portCalls, cruise.arrivalPort);
  const features: GeometryFeature[] = [];
  let routedLegs = 0;
  let directLegs = 0;

  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];
    const b = ordered[i + 1];

    const route = await computeSchematicRoute(
      { id: a.id, name: a.name, city: a.city, country: a.country, unlocode: a.unlocode, lat: a.lat, lon: a.lon },
      { id: b.id, name: b.name, city: b.city, country: b.country, unlocode: b.unlocode, lat: b.lat, lon: b.lon },
    );
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: route.waypoints },
      properties: {
        fromPortId: a.id,
        toPortId: b.id,
        routed: route.routed,
        protectedPrefixCount: route.protectedPrefixCount,
        protectedSuffixCount: route.protectedSuffixCount,
        method: route.method,
      },
    });
    if (route.routed) routedLegs++;
    else directLegs++;
  }

  return { collection: { type: 'FeatureCollection', features }, routedLegs, directLegs };
}

const router = Router();
router.use(authenticate);

const CRUISE_INCLUDE = {
  ship: true,
  departurePort: true,
  arrivalPort: true,
  stops: { include: { port: true }, orderBy: { dayNumber: 'asc' as const } },
  legs: { orderBy: { ordinal: 'asc' as const } },
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
/**
 * POST /api/v1/cruises/geometry/batch
 *
 * Body: { ids: string[] } (max 100 cruise UUIDs)
 * Returns: { success: true, data: { [cruiseId]: FeatureCollection } }
 *
 * Eliminates the dashboard's previous N sequential GETs for N cruises.
 * Cruises not owned by the requesting user are silently skipped (the
 * key is omitted from the response). Inside, each cruise's leg loop
 * benefits from `computeSchematicRoute`'s in-memory cache so the second
 * cruise that crosses the same port-pair is a Map.get.
 *
 * Defined BEFORE the `/:id/geometry` route so Express doesn't try to
 * match `geometry` as the `:id` parameter.
 */
const geometryBatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

router.post('/geometry/batch', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = geometryBatchSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const cruises = await prisma.cruise.findMany({
      where: { id: { in: parsed.data.ids }, userId },
      include: {
        stops: { include: { port: true }, orderBy: { dayNumber: 'asc' as const } },
        departurePort: true,
        arrivalPort: true,
      },
    });

    const computedAt = Date.now();
    const data: Record<string, GeometryFeatureCollection> = {};
    let totalRouted = 0;
    let totalDirect = 0;

    // Parallel — each leg lookup is sub-millisecond after the first
    // miss, so concurrency just amortises the cache misses across
    // cruises without overloading anything.
    const results = await Promise.all(
      cruises.map(async (cruise) => ({ id: cruise.id, ...(await buildCruiseGeometry(cruise)) })),
    );
    for (const r of results) {
      data[r.id] = r.collection;
      totalRouted += r.routedLegs;
      totalDirect += r.directLegs;
    }

    logger.info({
      operation: 'cruise_geometry_batch',
      userId,
      requested: parsed.data.ids.length,
      returned: cruises.length,
      routedLegs: totalRouted,
      directLegs: totalDirect,
      durationMs: Date.now() - computedAt,
    });

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/geometry', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const cruise = await prisma.cruise.findFirst({
      where: { id: req.params.id, userId },
      include: {
        stops: { include: { port: true }, orderBy: { dayNumber: 'asc' as const } },
        departurePort: true,
        arrivalPort: true,
      },
    });
    if (!cruise) throw new AppError('Cruise not found', 404);

    const computedAt = Date.now();
    const { collection, routedLegs, directLegs } = await buildCruiseGeometry(cruise);

    logger.info({
      operation: 'cruise_geometry_computed',
      cruiseId: cruise.id,
      userId,
      stops: cruise.stops.filter((s) => !s.isAtSea && s.port !== null).length,
      routedLegs,
      directLegs,
      durationMs: Date.now() - computedAt,
    });

    res.json({ success: true, data: collection });
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

      await recomputeLegsForCruise(created.id, tx);
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

      // Legs span departure port → stops → arrival port, so a changed
      // departure/arrival port invalidates them just like changed stops.
      const portsChanged =
        'departurePortId' in parsed.data || 'arrivalPortId' in parsed.data;
      if (stops !== undefined || portsChanged) {
        await recomputeLegsForCruise(existing.id, tx);
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
