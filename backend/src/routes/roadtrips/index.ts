import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { createRoadtripSchema } from "../../schemas/roadtrip";
import { travelledKm } from "../../services/tour/tourDistance";
import { describeRoutingAvailability } from "../../services/tour/routing/resolveProvider";
import {
  STATION_SELECT,
  nightsOf,
  spanOf,
  stationCountries,
  toRoadtripSummary,
  toStationDto,
} from "../../services/roadtrip/roadtripSummary";
import { resolveTrip } from "../trips/resolveTrip";
import { toDto, toLegDto, ROUTE_SELECT } from "../trips/tourRoutes";
import logger from "../../utils/logger";
import { getCountryResolver } from "../../services/geo/countryFromCoordinates";
import stationRoutes from "./stations";
import { resolveRoadtrip } from "../../services/roadtrip/resolveRoadtrip";

/**
 * Roadtrips (design 2026-09-24). A roadtrip is a `TripRoute` with
 * `kind = "roadtrip"`: this router owns only what is new — the list, the
 * detail with stations and their stays, creation, and the station list
 * (`./stations.ts`). Everything a roadtrip shares with a tour — legs,
 * routing, tracks, geometry, rename, delete — is served by the kind-agnostic
 * `/tours/:routeId/*` family, which is the point of one engine.
 *
 * Middleware is PER ROUTE, never `router.use()`: a router-level
 * `authenticate` mounted at `/api/v1` would swallow every later mount's
 * requests (the phase-1 bug that 401'd the public pairing endpoints).
 */
const router = Router();

const LIST_SELECT = {
  id: true,
  tripId: true,
  name: true,
  mode: true,
  color: true,
  vehicle: true,
  vehicleName: true,
  kindAssignedAutomatically: true,
  startOdometerKm: true,
  endOdometerKm: true,
  trip: { select: { name: true } },
  legs: { select: { mode: true, distanceKm: true } },
  stops: { select: STATION_SELECT, orderBy: { routeOrderIdx: "asc" } },
  _count: { select: { tracks: true } },
} as const;

/** How many day tours set out from each roadtrip's stations. */
async function tourCountsByRoadtrip(userId: string, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const tours = await prisma.tripRoute.findMany({
    where: { userId, kind: "tour", anchorStop: { routeId: { in: ids } } },
    select: { anchorStop: { select: { routeId: true } } },
  });
  const counts = new Map<string, number>();
  for (const t of tours) {
    const id = t.anchorStop?.routeId;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** GET /roadtrips — newest first by the span the stations cover. */
router.get(
  "/roadtrips",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const rows = await prisma.tripRoute.findMany({
        where: { userId, kind: "roadtrip" },
        select: LIST_SELECT,
      });
      const tourCounts = await tourCountsByRoadtrip(
        userId,
        rows.map((r) => r.id)
      );
      const resolver = rows.length > 0 ? await getCountryResolver() : null;
      const roadtrips = rows
        .map((r) =>
          toRoadtripSummary(
            r,
            tourCounts.get(r.id) ?? 0,
            resolver ? stationCountries(r.stops, resolver) : []
          )
        )
        // Sort-then-return: the order key is derived from the stations and
        // cannot be pushed into the query. Undated ones go last.
        .sort((a, b) => String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")));
      res.json({ roadtrips });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /roadtrips — optionally inside a trip the caller owns. */
router.post(
  "/roadtrips",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const { tripId, ...body } = createRoadtripSchema.parse(req.body);
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
          kind: "roadtrip",
          name: body.name,
          mode: body.mode,
          vehicle: body.vehicle ?? null,
          vehicleName: body.vehicleName ?? null,
          color: body.color,
          notes: body.notes,
          startOdometerKm: body.startOdometerKm,
          endOdometerKm: body.endOdometerKm,
          orderIdx: last ? last.orderIdx + 1 : 0,
        },
        include: ROUTE_SELECT,
      });
      logger.info({ operation: "roadtrip.create", routeId: route.id, tripId: tripId ?? null });
      res.status(201).json({ roadtrip: toDto(route) });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /roadtrips/:id — the roadtrip, its stations with their stays, legs and day tours. */
router.get(
  "/roadtrips/:id",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const id = await resolveRoadtrip(userId, req.params.id);

      const [route, stations, legs, tours, routing] = await Promise.all([
        prisma.tripRoute.findUniqueOrThrow({
          where: { id },
          include: { ...ROUTE_SELECT, trip: { select: { id: true, name: true } } },
        }),
        prisma.tripStop.findMany({
          where: { routeId: id },
          orderBy: { routeOrderIdx: "asc" },
          select: STATION_SELECT,
        }),
        prisma.tripRouteLeg.findMany({
          where: { routeId: id },
          orderBy: { fromStop: { routeOrderIdx: "asc" } },
        }),
        prisma.tripRoute.findMany({
          where: { userId, kind: "tour", anchorStop: { routeId: id } },
          select: {
            id: true,
            name: true,
            activity: true,
            anchorStopId: true,
            legs: { select: { distanceKm: true } },
            tracks: {
              select: { distanceKm: true, ascentM: true, startedAt: true },
              orderBy: { startedAt: "asc" },
            },
          },
        }),
        describeRoutingAvailability(userId),
      ]);

      const nights = nightsOf(stations);
      const resolver = await getCountryResolver();
      res.json({
        countries: stationCountries(stations, resolver),
        roadtrip: toDto(route),
        trip: route.trip,
        ...spanOf(stations),
        nights,
        stations: stations.map(toStationDto),
        legs: legs.map(toLegDto),
        tours: tours.map((t) => ({
          id: t.id,
          name: t.name,
          activity: t.activity,
          anchorStopId: t.anchorStopId,
          // A day tour is measured by its recording; legs only when it has none.
          distanceKm:
            t.tracks.length > 0
              ? t.tracks.reduce((sum, tr) => sum + tr.distanceKm, 0)
              : travelledKm(t.legs),
          ascentM: t.tracks.every((tr) => tr.ascentM === null)
            ? null
            : t.tracks.reduce((sum, tr) => sum + (tr.ascentM ?? 0), 0),
          startedAt: t.tracks[0]?.startedAt ?? null,
        })),
        routingAvailable: routing.configured,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.use(stationRoutes);

export default router;
