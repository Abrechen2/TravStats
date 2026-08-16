import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { authenticate, requireWriteScope, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
  createCruiseSchema,
  updateCruiseSchema,
  cruiseQuerySchema,
  routeOverrideSchema,
  routeOverrideKeySchema,
} from '../schemas/cruise';
import { checkAndUpdateAchievements } from '../utils/achievements';
import { buildEffectivePortSequence } from '../shared/cruise/portSequence';
import { buildLegRouteOverrideMap, portLegRouteKey } from '../shared/cruise/legRouteKey';
import { computeSchematicRoute } from '../services/schematicRouter';
import { recomputeLegsForCruise } from '../services/cruiseDistance/cruiseLegService';
import { cruiseExternalRef } from '../services/importProvenance';
import { deriveCruiseStatus, CRUISE_PASSTHROUGH } from '../shared/statusDerivation';
import { recomputeTripStatus } from '../services/tripStatusService';
import { resolveCompanions, linkRowsFor } from '../services/companionService';
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
    method: 'short_hop' | 'maritime_graph' | 'coarse_a_star' | 'direct' | 'manual_polyline';
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
  legRoutes?: Array<{
    fromKind: string;
    fromRef: string;
    toKind: string;
    toRef: string;
    waypoints: unknown;
  }>;
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

  // The stored line wins. It has to be the same source the distance came from
  // (services/cruiseDistance/cruiseLegService.ts), or the map and the
  // statistics would quietly disagree.
  const overrideByLeg = buildLegRouteOverrideMap(cruise.legRoutes ?? []);

  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];
    const b = ordered[i + 1];

    const manual = overrideByLeg.get(portLegRouteKey(a.id, b.id));
    if (manual && manual.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: manual },
        properties: {
          fromPortId: a.id,
          toPortId: b.id,
          routed: false,
          protectedPrefixCount: 0,
          protectedSuffixCount: 0,
          method: 'manual_polyline',
        },
      });
      directLegs++;
      continue;
    }

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
// Method-aware: GET passes through, so read-only PATs keep read access but
// cannot POST/PATCH/DELETE cruises — consistent with flights/trips.
router.use(requireWriteScope);

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

/**
 * Is `from → to` an actual leg of this cruise's itinerary?
 *
 * Checked on every write. Without it the table accepts lines for legs that do
 * not exist, which can never match anything on read — the user would see a
 * silent no-op instead of an error.
 */
async function legExists(
  cruiseId: string,
  userId: string,
  fromRef: string,
  toRef: string,
): Promise<boolean> {
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
  if (!cruise) return false;

  const portCalls = cruise.stops
    .filter((s): s is typeof s & { port: NonNullable<typeof s.port> } => s.port !== null)
    .map((s) => s.port);
  const sequence = buildEffectivePortSequence(cruise.departurePort, portCalls, cruise.arrivalPort);

  for (let i = 1; i < sequence.length; i++) {
    if (String(sequence[i - 1].id) === fromRef && String(sequence[i].id) === toRef) return true;
  }
  return false;
}

router.put('/:id/route-override', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = routeOverrideSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const { fromKind, fromRef, toKind, toRef, waypoints } = parsed.data;

    if (!(await legExists(req.params.id, userId, fromRef, toRef))) {
      throw new AppError('Cruise or leg not found', 404);
    }

    const key = { cruiseId: req.params.id, fromKind, fromRef, toKind, toRef };
    const existing = await prisma.cruiseLegRoute.findUnique({
      where: { cruiseId_fromKind_fromRef_toKind_toRef: key },
      select: { id: true },
    });

    const row = await prisma.cruiseLegRoute.upsert({
      where: { cruiseId_fromKind_fromRef_toKind_toRef: key },
      create: { ...key, waypoints: waypoints as unknown as Prisma.InputJsonValue },
      update: { waypoints: waypoints as unknown as Prisma.InputJsonValue },
    });

    await recomputeLegsForCruise(req.params.id);

    logger.info({
      operation: 'cruise_route_override_saved',
      cruiseId: req.params.id,
      userId,
      fromRef,
      toRef,
      waypoints: waypoints.length,
      replaced: existing !== null,
    });

    res.status(existing ? 200 : 201).json({ success: true, data: row });
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

      const { count } = await prisma.cruiseLegRoute.deleteMany({
        where: { cruiseId: req.params.id, ...parsed.data },
      });

      await recomputeLegsForCruise(req.params.id);

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
        legRoutes: true,
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
        legRoutes: true,
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

    const { stops, startDate, endDate, tripId, bookingId, status, companions, importBatchId, ...rest } =
      parsed.data;

    // A batch id means "this came from an import". It is client-supplied, so
    // ownership is checked here — otherwise it is a handle into someone
    // else's undo history. An unrecognised one is dropped rather than
    // refused: the cruise the user asked for matters more than the record of
    // where it came from.
    let batchId: string | null = null;
    if (importBatchId) {
      const batch = await prisma.importBatch.findFirst({
        where: { id: importBatchId, userId, domain: "cruise" },
        select: { id: true },
      });
      batchId = batch?.id ?? null;
    }
    // Derived here, not by the caller: what counts as "the same cruise" is a
    // rule about the data, and every client restating it would be a rule with
    // several versions.
    const externalRef = batchId
      ? cruiseExternalRef({
          bookingReference: rest.bookingReference,
          shipNameOverride: rest.shipNameOverride,
          cruiseLine: rest.cruiseLine,
          startDate,
        })
      : null;

    // Reading the same confirmation twice is a normal thing to do — a forward,
    // a second copy in the inbox. Answering it with a 500 from a unique-index
    // violation would read as "the import is broken"; 409 says what actually
    // happened, and the importer counts it instead of creating a twin.
    if (externalRef) {
      const existing = await prisma.cruise.findFirst({
        where: { userId, externalRef },
        select: { id: true },
      });
      if (existing) {
        res.status(409).json({
          success: false,
          error: 'already_imported',
          data: { id: existing.id },
        });
        return;
      }
    }

    const startDateUtc = startDate ? new Date(startDate) : null;
    const endDateUtc = endDate ? new Date(endDate) : null;

    // The status field is a client-sent HINT, not the source of truth (spec
    // 2026-07-17-status-from-dates) — passthrough statuses (cancelled,
    // historical) are assigned verbatim, everything else (including the
    // schema's 'scheduled' default) is derived from the dates being written.
    const effectiveStatus = (CRUISE_PASSTHROUGH as readonly string[]).includes(status)
      ? status
      : deriveCruiseStatus({ startDate: startDateUtc, endDate: endDateUtc, current: status });

    // Resolve companion names to Companion entities up front (find-or-create
    // is idempotent via companionService, so it's safe to run outside the
    // transaction below — it cannot participate in a passed `tx` anyway). The
    // cruise row and its links are written together inside the transaction so
    // a failure never leaves the legacy `companions` array and the
    // `companionLinks` table disagreeing. Mirrors routes/trips.ts.
    const companionNames = companions ?? [];
    const resolvedCompanions = await resolveCompanions(userId, companionNames);

    const cruise = await prisma.$transaction(async (tx) => {
      const created = await tx.cruise.create({
        data: {
          userId,
          ...rest,
          importBatchId: batchId,
          externalRef,
          status: effectiveStatus,
          startDate: startDateUtc,
          endDate: endDateUtc,
          tripId: tripId ?? null,
          bookingId: bookingId ?? null,
          // Dual write: resolved display names keep this legacy array in
          // agreement with `companionLinks` below (trimmed, blanks dropped,
          // newest spelling wins) — the previous image still reads this column.
          companions: resolvedCompanions.map((c) => c.displayName),
        },
      });

      if (resolvedCompanions.length > 0) {
        await tx.cruiseCompanion.createMany({
          data: linkRowsFor(resolvedCompanions.map((c) => c.id)).map((row) => ({
            ...row,
            cruiseId: created.id,
          })),
          skipDuplicates: true,
        });
      }

      if (stops && stops.length > 0) {
        await tx.cruiseStop.createMany({
          data: stops.map((s) => ({
            cruiseId: created.id,
            portId: s.portId ?? null,
            dayNumber: s.dayNumber,
            date: s.date ? new Date(s.date) : null,
            isAtSea: s.isAtSea,
            arrivalTime: s.arrivalTime ? new Date(s.arrivalTime) : null,
            departureTime: s.departureTime ? new Date(s.departureTime) : null,
            excursionNote: s.excursionNote ?? null,
            unresolvedPortName: s.unresolvedPortName ?? null,
          })),
        });
      }

      await recomputeLegsForCruise(created.id, tx);
      return tx.cruise.findUniqueOrThrow({ where: { id: created.id }, include: CRUISE_INCLUDE });
    });

    // Status derivation (spec 2026-07-17-status-from-dates) needs to read
    // the cruise it just linked, so recomputeTripStatus() runs AFTER the
    // transaction commits — same after-commit idiom as flightsBatch.ts.
    if (cruise.tripId) {
      await recomputeTripStatus(cruise.tripId);
    }

    // Await the recalc (was fire-and-forget). Its $transaction on
    // user_achievement rows must commit before the response returns — a
    // leaked, un-awaited transaction outlived the request and deadlocked
    // (40P01) against the next mutation or the test teardown cascade, and
    // could silently drop an achievement update on a rapid double-mutation
    // for one user. Mirrors the awaited try/catch in flights.ts.
    try {
      await checkAndUpdateAchievements(userId);
    } catch (achErr) {
      logger.error({
        operation: 'cruise_achievement_check_failed',
        error: achErr instanceof Error ? achErr.message : achErr,
      });
    }

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

    const { stops, startDate, endDate, status: requestedStatus, companions, ...rest } =
      parsed.data;

    const nextStartDate =
      startDate === undefined ? undefined : startDate ? new Date(startDate) : null;
    const nextEndDate = endDate === undefined ? undefined : endDate ? new Date(endDate) : null;

    // The status field is a client-sent HINT, not the source of truth (spec
    // 2026-07-17-status-from-dates). Derive from the FINAL start/end values —
    // an update may move dates without sending status, or send status
    // without moving dates — merged with the existing row's stored dates.
    const isRequestedPassthrough =
      requestedStatus !== undefined &&
      (CRUISE_PASSTHROUGH as readonly string[]).includes(requestedStatus);
    const currentIsPassthrough = (CRUISE_PASSTHROUGH as readonly string[]).includes(
      existing.status,
    );
    let effectiveStatus: string | undefined;
    if (isRequestedPassthrough) {
      // Passthrough statuses are always assigned verbatim.
      effectiveStatus = requestedStatus;
    } else if (requestedStatus === undefined && currentIsPassthrough) {
      // Stored status is passthrough and no status field arrived — leave it
      // alone. A bare date edit must never pull a cancelled/historical
      // cruise back into the derived scheduled/in_progress/flown lifecycle.
      effectiveStatus = undefined;
    } else {
      const finalStart = nextStartDate !== undefined ? nextStartDate : existing.startDate;
      const finalEnd = nextEndDate !== undefined ? nextEndDate : existing.endDate;
      effectiveStatus = deriveCruiseStatus({
        startDate: finalStart,
        endDate: finalEnd,
        current: requestedStatus ?? existing.status,
      });
    }

    // Replace rather than append — an update always carries the FULL
    // companion list for the cruise, so stale links must go. Resolution
    // itself (find-or-create against Companion) is idempotent and safe to
    // run here, outside any transaction — same reasoning as the create
    // handler. The actual link replacement is deferred and run together
    // with the `cruise.update` call below inside one `prisma.$transaction`,
    // so a failure between the two never leaves the legacy array and
    // `companionLinks` disagreeing (undefined here means "untouched": the
    // companions field was not part of this update at all).
    let resolvedCompanionsForUpdate: { id: string; displayName: string }[] | undefined;
    if (companions !== undefined) {
      resolvedCompanionsForUpdate = await resolveCompanions(userId, companions);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (resolvedCompanionsForUpdate !== undefined) {
        await tx.cruiseCompanion.deleteMany({ where: { cruiseId: existing.id } });
        if (resolvedCompanionsForUpdate.length > 0) {
          await tx.cruiseCompanion.createMany({
            data: linkRowsFor(resolvedCompanionsForUpdate.map((c) => c.id)).map((row) => ({
              ...row,
              cruiseId: existing.id,
            })),
            skipDuplicates: true,
          });
        }
      }

      await tx.cruise.update({
        where: { id: existing.id },
        data: {
          ...rest,
          status: effectiveStatus,
          startDate: nextStartDate,
          endDate: nextEndDate,
          ...(resolvedCompanionsForUpdate !== undefined && {
            companions: resolvedCompanionsForUpdate.map((c) => c.displayName),
          }),
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
              date: s.date ? new Date(s.date) : null,
              isAtSea: s.isAtSea,
              arrivalTime: s.arrivalTime ? new Date(s.arrivalTime) : null,
              departureTime: s.departureTime ? new Date(s.departureTime) : null,
              excursionNote: s.excursionNote ?? null,
              unresolvedPortName: s.unresolvedPortName ?? null,
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

    // Status derivation (spec 2026-07-17-status-from-dates) needs to read
    // the FINAL linked cruise, so recomputeTripStatus() runs AFTER the
    // transaction commits. Covers both a plain date/status edit on an
    // already-linked cruise AND a tripId move — recompute whichever of the
    // old/new trip the cruise was or is now linked to (both, if it moved).
    const oldTripId = existing.tripId;
    const newTripId = 'tripId' in rest ? (rest.tripId ?? null) : oldTripId;
    const tripIdsToRecompute = new Set<string>();
    if (oldTripId) tripIdsToRecompute.add(oldTripId);
    if (newTripId) tripIdsToRecompute.add(newTripId);
    for (const id of tripIdsToRecompute) {
      await recomputeTripStatus(id);
    }

    // Await the recalc (was fire-and-forget). Its $transaction on
    // user_achievement rows must commit before the response returns — a
    // leaked, un-awaited transaction outlived the request and deadlocked
    // (40P01) against the next mutation or the test teardown cascade, and
    // could silently drop an achievement update on a rapid double-mutation
    // for one user. Mirrors the awaited try/catch in flights.ts.
    try {
      await checkAndUpdateAchievements(userId);
    } catch (achErr) {
      logger.error({
        operation: 'cruise_achievement_check_failed',
        error: achErr instanceof Error ? achErr.message : achErr,
      });
    }

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
