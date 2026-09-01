import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { ACCEPTED_LEG_SOURCES } from "../../schemas/tour";
import { LEG_MODES, LegMode } from "../../services/tour/tourDistance";
import { resolveRouteProvider } from "../../services/tour/routing/resolveProvider";
import { routeLegGeometry, RoutedLeg } from "../../services/tour/routing/routeLeg";
import { isRoutableMode, RouteProvider } from "../../services/tour/routing/types";
import { resolveTrip } from "../trips";
import { findLegOrThrow, requireCoords } from "./tourLegs";
import { resolveRoute, toDto, toLegDto, ROUTE_SELECT } from "./tourRoutes";
import logger from "../../utils/logger";

/**
 * Tour route provider-routing endpoints — split out of `tourLegs.ts` (task 6
 * of phase 3), which was already at 300+ lines against the 400-line "ideal"
 * ceiling before these two handlers existed. Mounted at the SAME `/trips`
 * prefix as `tourRoutes.ts`/`tourLegs.ts`, the same satellite-router pattern.
 *
 * Two capabilities live here:
 *  - `POST .../legs/:fromStopId/:toStopId/route` — route ONE leg through the
 *    configured provider.
 *  - `POST .../route-all` — route every routable leg of a section in one call.
 *
 * Both delegate the actual routing decision to `routeLegGeometry`
 * (`services/tour/routing/routeLeg.ts`, built in task 5 — NOT modified
 * here): that function already encodes the full fallback rule (unroutable
 * mode → chord, no provider → chord, provider failure or an untrustworthy
 * answer → chord). This module's own job is strictly the HTTP surface: load
 * the leg(s), decide up front whether the "no provider at all" case is a
 * hard 409 (single leg) or a per-leg skip that still returns 200 (route-all),
 * persist the result, and shape the response.
 */

const router = Router();

/**
 * `TripRouteLeg.mode` is a plain Prisma `String` column (see schema.prisma —
 * it is validated to a `LEG_MODES` member only at WRITE time, by
 * `createRouteSchema`/`updateRouteSchema`/the leg-override PUT), so reading
 * it back gives `string`, not the `LegMode` union `routeLegGeometry` and
 * `isRoutableMode` require. This backstop narrows it the same way
 * `requireCoords` (in `tourLegs.ts`) backstops a nullable coordinate: it
 * should never fire against data written through this codebase's own write
 * paths, and fails loudly (409, "instance not equipped to handle this data")
 * rather than smuggling an `as LegMode` cast past the `any`-forbidden rule.
 */
function requireLegMode(mode: string): LegMode {
  if ((LEG_MODES as readonly string[]).includes(mode)) {
    return mode as LegMode;
  }
  throw new AppError(`Leg has an unrecognised mode "${mode}"`, 409);
}

/**
 * The write-side counterpart of `schemas/tour.ts`'s `MANUAL_LEG_SOURCES`
 * split: this is the routing endpoints' own boundary check on what they
 * persist, using `ACCEPTED_LEG_SOURCES` (`straight | drawn | routed` —
 * everything the column may hold, as opposed to `MANUAL_LEG_SOURCES`,
 * which is what a caller may hand the manual override endpoint). `routed.source`
 * is already typed `"routed" | "straight"` by `RoutedLeg`, so this can never
 * actually fail today — it is the same belt-and-suspenders backstop as
 * `requireLegMode` above: cheap insurance against a future change to
 * `routeLegGeometry` silently writing a value this column is not meant to
 * hold, rather than an `as` cast past the `any`-forbidden rule.
 */
const acceptedLegSource = z.enum(ACCEPTED_LEG_SOURCES);

/** Persist one leg's routing outcome — shared by both endpoints below. */
async function applyRoutedLeg(legId: string, routed: RoutedLeg): Promise<void> {
  const source = acceptedLegSource.parse(routed.source);
  await prisma.tripRouteLeg.update({
    where: { id: legId },
    data: {
      source,
      confidence: routed.confidence,
      waypoints:
        routed.waypoints === null
          ? Prisma.DbNull
          : (routed.waypoints as unknown as Prisma.InputJsonValue),
      distanceKm: routed.distanceKm,
      drivingMinutes: routed.drivingMinutes,
    },
  });
}

/**
 * POST /trips/:id/routes/:routeId/legs/:fromStopId/:toStopId/route
 *
 * Routes ONE leg through the configured provider and stores the result.
 *
 * No provider configured is a **409**, not a 400: the caller's request is
 * fine (it names a real leg), the INSTANCE is not equipped to answer it —
 * exactly the reasoning `requireCoords` already uses for a leg that lost its
 * stop coordinates. A provider that IS configured but fails, times out, or
 * returns an untrustworthy line is a different case entirely: that is
 * `routeLegGeometry`'s own straight-chord fallback, and it is not an error —
 * the leg is still updated (to `source: "straight"`, `confidence: "low"`)
 * and this endpoint answers 200 with that honest result, same as `route-all`
 * does for a per-leg provider failure inside a batch.
 */
router.post(
  "/trips/:id/routes/:routeId/legs/:fromStopId/:toStopId/route",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);

      const provider: RouteProvider | null = await resolveRouteProvider(userId);
      if (provider === null) {
        throw new AppError(
          "Routing is not configured for this instance — no provider is set up",
          409,
        );
      }

      const leg = await findLegOrThrow(routeId, req.params.fromStopId, req.params.toStopId);
      const fromCoord = requireCoords(leg.fromStop, "from");
      const toCoord = requireCoords(leg.toStop, "to");
      const mode = requireLegMode(leg.mode);

      const routed = await routeLegGeometry(provider, { from: fromCoord, to: toCoord, mode });
      await applyRoutedLeg(leg.id, routed);

      const updated = await prisma.tripRouteLeg.findUniqueOrThrow({ where: { id: leg.id } });

      logger.info({
        operation: "tour.leg.route",
        legId: updated.id,
        providerId: provider.id,
        source: updated.source,
        confidence: updated.confidence,
      });
      res.json({ leg: toLegDto(updated) });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /trips/:id/routes/:routeId/route-all
 *
 * Routes every routable leg of a section in one call. Unlike the single-leg
 * endpoint above, an unconfigured provider does NOT 409 here — a bulk
 * "route everything" action degrades to "every routable leg falls back to
 * its straight chord", which is exactly what `routeLegGeometry(null, …)`
 * already does deliberately (see its own doc comment). Failing the whole
 * batch because routing is not configured would be a worse outcome for a
 * multi-leg section than silently leaving every leg as an honest chord; the
 * response's `routedCount`/`skippedCount` make what happened legible either
 * way.
 *
 * - A leg whose mode `isRoutableMode` rejects (ferry, rail) is left
 *   completely untouched and counted in `skippedCount` — it is never even
 *   handed to `routeLegGeometry`, so a stray provider quirk can never turn a
 *   ferry crossing into a road detour.
 * - Every other leg is counted in `routedCount`, whether the provider
 *   actually answered (`source: "routed"`) or the call fell back to a
 *   straight chord (`source: "straight"`, `confidence: "low"`) — "routed"
 *   here means "was run through the routing pipeline", not "provider
 *   succeeded"; that distinction is what `confidence` on each returned leg
 *   is for.
 *
 * Each leg is routed and persisted sequentially rather than in one
 * transaction: a provider call is a network round trip, and holding a
 * database transaction open across several of those (a section can have
 * many legs) would tie up a connection for however long the slowest
 * provider call takes. A partial failure partway through must not roll back
 * the legs already routed — those results are real and worth keeping.
 */
router.post(
  "/trips/:id/routes/:routeId/route-all",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);

      const provider = await resolveRouteProvider(userId);

      const legs = await prisma.tripRouteLeg.findMany({
        where: { routeId },
        orderBy: { fromStop: { routeOrderIdx: "asc" } },
        include: {
          fromStop: { select: { lat: true, lon: true } },
          toStop: { select: { lat: true, lon: true } },
        },
      });

      let routedCount = 0;
      let skippedCount = 0;

      for (const leg of legs) {
        const mode = requireLegMode(leg.mode);
        if (!isRoutableMode(mode)) {
          skippedCount++;
          continue;
        }

        const fromCoord = requireCoords(leg.fromStop, "from");
        const toCoord = requireCoords(leg.toStop, "to");
        const routed = await routeLegGeometry(provider, { from: fromCoord, to: toCoord, mode });
        await applyRoutedLeg(leg.id, routed);
        routedCount++;
      }

      const [route, savedLegs] = await Promise.all([
        prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId }, include: ROUTE_SELECT }),
        prisma.tripRouteLeg.findMany({
          where: { routeId },
          orderBy: { fromStop: { routeOrderIdx: "asc" } },
        }),
      ]);

      logger.info({
        operation: "tour.route.routeAll",
        routeId,
        providerId: provider?.id ?? null,
        routedCount,
        skippedCount,
      });
      res.json({
        route: toDto(route),
        legs: savedLegs.map(toLegDto),
        routedCount,
        skippedCount,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
