import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { createTourSchema, tourGeometryBatchSchema } from "../../schemas/tour";
import { listToursQuerySchema } from "../../schemas/roadtrip";
import { travelledKm } from "../../services/tour/tourDistance";
import logger from "../../utils/logger";
import { buildRouteGeometry, RouteGeometryFeatureCollection } from "./tourLegs";
import { toDto, ROUTE_SELECT } from "./tourRoutes";
import { resolveTrip } from "../trips";

/**
 * Dashboard-wide tour endpoints — the two things the ALL-trips map needs
 * that no per-trip router can answer, because they deliberately span
 * every trip the caller owns rather than one:
 *
 *   GET  /tours                -> every tour section the caller owns,
 *                                  across all trips, summary only
 *   POST /tours/geometry/batch -> that geometry for a chosen subset, one
 *                                  round trip instead of N sequential GETs
 *
 * Split out as its own same-prefix satellite router rather than folded
 * into `tourRoutes.ts`, `tourLegs.ts`, `tourRouting.ts`, or `tourTracks.ts`
 * — all four of those are trip-scoped (`/trips/:id/routes/...`) and lean
 * on `resolveTrip`/`resolveRoute` for ownership; these two routes have no
 * `:id` trip segment at all; the ownership filter goes straight into the
 * `where` instead.
 *
 * **Middleware is PER ROUTE, never `router.use()`** — this router mounts
 * at the plain `/api/v1` prefix alongside its siblings, and a router-level
 * guard here would swallow every LATER `/api/v1` mount's requests. That
 * exact bug once reached this branch and 401'd the public pairing
 * endpoints (see the regression test in `__tests__/tourTracks.test.ts`).
 */

const router = Router();

interface TourSummaryRow {
  id: string;
  /** `null` for a standalone tour — one that belongs to no trip. */
  tripId: string | null;
  name: string;
  mode: string;
  kind: string;
  activity: string | null;
  vehicle: string | null;
  kindAssignedAutomatically: boolean;
  tracks: Array<{
    distanceKm: number;
    ascentM: number | null;
    movingSeconds: number | null;
    startedAt: Date;
  }>;
  trip: { name: string } | null;
  legs: Array<{ distanceKm: number }>;
  _count: { stops: number };
  stops: Array<{ startDate: Date | null; endDate: Date | null }>;
}

/**
 * Explicit `select`, never `include` — the same discipline
 * `tourTracks.ts`'s `TRACK_META_SELECT` uses for the same reason: a line
 * is location data, and a list call must not ship megabytes of it just
 * because it happened to be reachable through a relation. Neither
 * `TripRouteLeg.waypoints` nor any stop coordinate is selected here.
 */
const TOUR_SUMMARY_SELECT = {
  id: true,
  tripId: true,
  name: true,
  mode: true,
  kind: true,
  activity: true,
  vehicle: true,
  kindAssignedAutomatically: true,
  tracks: {
    select: { distanceKm: true, ascentM: true, movingSeconds: true, startedAt: true },
    orderBy: { startedAt: "asc" },
  },
  trip: { select: { name: true } },
  legs: { select: { distanceKm: true } },
  _count: { select: { stops: true } },
  stops: { select: { startDate: true, endDate: true } },
} as const;

/**
 * A section's date span: the earliest stop start and the latest stop end,
 * across whichever of its stops carry dates at all. A stop without an
 * `endDate` counts its `startDate` for the end side too (a single-day
 * stop), matching how `Trip`'s own timeline treats a dateless single point.
 * Both sides are `null` when no stop in the section carries a date.
 */
function sectionDateSpan(stops: TourSummaryRow["stops"]): {
  startDate: string | null;
  endDate: string | null;
} {
  let earliestStart: Date | null = null;
  let latestEnd: Date | null = null;

  for (const stop of stops) {
    const end = stop.endDate ?? stop.startDate;
    if (stop.startDate && (!earliestStart || stop.startDate < earliestStart)) {
      earliestStart = stop.startDate;
    }
    if (end && (!latestEnd || end > latestEnd)) {
      latestEnd = end;
    }
  }

  return {
    startDate: earliestStart ? earliestStart.toISOString() : null,
    endDate: latestEnd ? latestEnd.toISOString() : null,
  };
}

/**
 * Sum a figure over the tracks, or `null` when no track carries it — a tour
 * whose recordings have no elevation did not climb zero metres.
 */
function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

function toTourSummary(route: TourSummaryRow): Record<string, unknown> {
  const span = sectionDateSpan(route.stops);
  const trackKm = route.tracks.reduce((sum, t) => sum + t.distanceKm, 0);
  // A day tour is measured by its recording (design 2026-09-24 §1); its legs
  // only speak when nothing was recorded. A roadtrip is measured by its legs.
  const fromTrack = route.kind === "tour" && route.tracks.length > 0;
  const firstTrack = route.tracks[0]?.startedAt ?? null;
  return {
    id: route.id,
    tripId: route.tripId,
    // `null` for a standalone tour. The list shows the trip's name as the
    // second line of a row; a tour with no trip simply has no second line,
    // rather than an invented one.
    tripName: route.trip?.name ?? null,
    name: route.name,
    mode: route.mode,
    kind: route.kind,
    activity: route.activity,
    vehicle: route.vehicle,
    kindAssignedAutomatically: route.kindAssignedAutomatically,
    distanceKm: fromTrack ? trackKm : travelledKm(route.legs),
    distanceSource: fromTrack ? "track" : "legs",
    ascentM: sumOrNull(route.tracks.map((t) => t.ascentM)),
    movingSeconds: sumOrNull(route.tracks.map((t) => t.movingSeconds)),
    trackCount: route.tracks.length,
    stopCount: route._count.stops,
    // A standalone tour has no dated stops; its recording says when it was.
    startDate: span.startDate ?? firstTrack?.toISOString() ?? null,
    endDate: span.endDate,
  };
}

/**
 * GET /tours
 *
 * Every section the caller owns, across every trip, ordered by the
 * owning trip's start date (undated trips last) and then by the
 * section's own `orderIdx` within it. No geometry — see the module doc
 * comment above and `TOUR_SUMMARY_SELECT`.
 */
router.get(
  "/tours",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const { kind } = listToursQuerySchema.parse(req.query);
      const routes = await prisma.tripRoute.findMany({
        // The section's OWN owner, not the trip's. A standalone tour has no
        // trip to be owned through, and `where: { trip: { userId } }` does
        // not merely fail to prove ownership for one — it silently omits it
        // from the list, which reads as "you have no tours".
        where: { userId, ...(kind ? { kind } : {}) },
        // Undated and trip-less sections sort last, both for the same
        // reason: nulls last on the trip's start date.
        orderBy: [{ trip: { startDate: "asc" } }, { orderIdx: "asc" }],
        select: TOUR_SUMMARY_SELECT,
      });

      res.json({ tours: routes.map(toTourSummary) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /tours
 *
 * Creates a tour. `tripId` is OPTIONAL: omit it and the tour stands on its
 * own, with no trip to be read, listed or owned through (owner ruling,
 * 2026-09-21 — "Sie können auch einzeln leben"). Where it IS given, the
 * trip is resolved first, so this is exactly `POST /trips/:id/routes` with
 * the trip named in the body instead of the path.
 *
 * `orderIdx` counts within the tour's own group — the trip's sections, or
 * the reader's trip-less ones — because that is the group it is ordered
 * against when listed.
 */
router.post(
  "/tours",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const { tripId, ...body } = createTourSchema.parse(req.body);
      if (tripId != null) await resolveTrip(userId, tripId);

      const last = await prisma.tripRoute.findFirst({
        where: { userId, tripId: tripId ?? null },
        orderBy: { orderIdx: "desc" },
        select: { orderIdx: true },
      });

      const route = await prisma.tripRoute.create({
        data: {
          userId,
          tripId: tripId ?? null,
          name: body.name,
          mode: body.mode,
          activity: body.activity ?? null,
          color: body.color,
          notes: body.notes,
          startOdometerKm: body.startOdometerKm,
          endOdometerKm: body.endOdometerKm,
          orderIdx: last ? last.orderIdx + 1 : 0,
        },
        include: ROUTE_SELECT,
      });

      logger.info({ operation: "tour.create", routeId: route.id, tripId: tripId ?? null });
      res.status(201).json({ route: toDto(route) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /tours/geometry/batch
 *
 * Body: { ids: string[] } (1-100 route UUIDs).
 * Returns: { data: { [routeId]: FeatureCollection } }
 *
 * Copies `POST /cruises/geometry/batch`'s shape and behaviour exactly
 * (`backend/src/routes/cruises.ts`, ~lines 216-260): ownership is a
 * `where` clause, not a post-fetch filter, and an id the caller does not
 * own is silently OMITTED from the response rather than failing the
 * whole batch — a dashboard covering many sections must not go blank
 * because one id is stale (a deleted section, someone else's id).
 *
 * Reuses `buildRouteGeometry` (`tourLegs.ts`) — the exact function
 * `GET /trips/:id/routes/:routeId/geometry` already uses — so there is
 * only one place that turns a section's legs into a FeatureCollection.
 */
router.post(
  "/tours/geometry/batch",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const parsed = tourGeometryBatchSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);

      const routes = await prisma.tripRoute.findMany({
        where: { id: { in: parsed.data.ids }, userId },
        select: { id: true },
      });

      const computedAt = Date.now();
      const data: Record<string, RouteGeometryFeatureCollection> = {};
      const results = await Promise.all(
        routes.map(async (route) => ({
          id: route.id,
          collection: await buildRouteGeometry(route.id),
        }))
      );
      for (const r of results) {
        data[r.id] = r.collection;
      }

      logger.info({
        operation: "tour.geometry_batch",
        userId,
        requested: parsed.data.ids.length,
        returned: routes.length,
        durationMs: Date.now() - computedAt,
      });

      res.json({ data });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
