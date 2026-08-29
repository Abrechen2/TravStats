import { Router, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { legOverrideSchema } from "../../schemas/tour";
import { legDistanceKm } from "../../services/tour/tourDistance";
import { adoptSegment, ANCHOR_TOLERANCE_KM } from "../../services/tour/tracks/adoptTrack";
import { haversineKm } from "../../shared/geo/haversine";
import { resolveTrip } from "../trips";
import logger from "../../utils/logger";
import { resolveRoute, toLegDto } from "./tourRoutes";
import { resolveTrack } from "./tourTracks";

/**
 * Tour route leg overrides — split out of `tourRoutes.ts`, which was
 * already at 406 lines against the 400-line "ideal" ceiling before this
 * file existed. Mounted at the SAME `/trips` prefix as `tourRoutes.ts`,
 * the same pattern `routes/cruises/routeOverride.ts` uses alongside
 * `routes/cruises.ts`.
 *
 * `ANCHOR_TOLERANCE_KM` — how far a drawn line, OR an adopted track
 * segment, may start or end from its leg's stop, in km — lives in
 * `services/tour/tracks/adoptTrack.ts` (task 5) and is imported here
 * rather than redefined, so the hand-drawn check below and the track
 * adoption below it can never drift onto two different numbers.
 */

const router = Router();

interface LegWithStops {
  id: string;
  mode: string;
  source: string;
  drivingMinutes: number | null;
  tollCost: number | null;
  currency: string | null;
  fromStop: { lat: number | null; lon: number | null };
  toStop: { lat: number | null; lon: number | null };
}

/**
 * Exported for `routes/trips/tourRouting.ts` (the routing endpoints split
 * out alongside this file) — both need the same "leg between these two
 * stops, with stop coordinates attached" lookup.
 */
export async function findLegOrThrow(
  routeId: string,
  fromStopId: string,
  toStopId: string,
): Promise<LegWithStops> {
  const leg = await prisma.tripRouteLeg.findUnique({
    where: {
      routeId_fromStopId_toStopId: { routeId, fromStopId, toStopId },
    },
    include: {
      fromStop: { select: { lat: true, lon: true } },
      toStop: { select: { lat: true, lon: true } },
    },
  });
  if (!leg) throw new AppError("Leg not found", 404);
  return leg;
}

/**
 * A leg's stop coordinates are non-null at creation time — `recomputeLegs`
 * in `services/tour/legRecompute.ts` refuses a coordinate-less stop before
 * a leg row is ever written. `PATCH /trips/:id/stops/:stopId` also refuses
 * to null `lat`/`lon` on a stop whose `routeId` is set, so the normal write
 * paths cannot produce a coordinate-less route member. This guard exists
 * anyway as a backstop: the Prisma column type stays nullable, so this is
 * the only way to keep the handler `unknown`-safe without a false-positive
 * `!` assertion — and it fails loudly (409) rather than crashing on a bad
 * haversine call.
 */
export function requireCoords(
  stop: { lat: number | null; lon: number | null },
  which: "from" | "to",
): { lat: number; lon: number } {
  if (stop.lat === null || stop.lon === null) {
    throw new AppError(`Leg's ${which} stop lost its coordinates`, 409);
  }
  return { lat: stop.lat, lon: stop.lon };
}

/**
 * PUT /trips/:id/routes/:routeId/legs/:fromStopId/:toStopId
 *
 * The leg must already exist — a line for a leg that is not in the
 * itinerary could never match anything on read, so the user would see a
 * silent no-op instead of an error. Same reasoning as the cruise route
 * override.
 *
 * The anchor check lives here rather than in Zod because it needs the
 * stops' coordinates from the database, which a schema cannot see.
 */
router.put(
  "/trips/:id/routes/:routeId/legs/:fromStopId/:toStopId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);
      const body = legOverrideSchema.parse(req.body);

      const leg = await findLegOrThrow(routeId, req.params.fromStopId, req.params.toStopId);
      const fromCoord = requireCoords(leg.fromStop, "from");
      const toCoord = requireCoords(leg.toStop, "to");

      if (body.source === "track") {
        // `resolveTrack` 404s if `trackId` doesn't belong to THIS route —
        // a track id lifted from another route (another user's, or even
        // a different section of this trip) must not adopt.
        const track = await resolveTrack(routeId, body.trackId);
        const trackGeometry = isCoordinatePolyline(track.geometry) ? track.geometry : [];
        const adoption = adoptSegment(trackGeometry, fromCoord, toCoord, {
          maxAnchorKm: ANCHOR_TOLERANCE_KM,
        });
        if (!adoption) {
          throw new AppError(
            `This track doesn't come within ${ANCHOR_TOLERANCE_KM} km of both of this leg's ` +
              "stops — it likely covers a different day or place. Not adopted; the leg is unchanged.",
            409,
          );
        }

        const updatedFromTrack = await prisma.tripRouteLeg.update({
          where: { id: leg.id },
          data: {
            source: "track",
            mode: body.mode ?? leg.mode,
            // A measured recording is the most trustworthy geometry this
            // product can have — more so than a hand-drawn line.
            confidence: "high",
            waypoints: adoption.waypoints as unknown as Prisma.InputJsonValue,
            distanceKm: adoption.distanceKm,
          },
        });

        logger.info({
          operation: "tour.leg.override",
          legId: updatedFromTrack.id,
          source: updatedFromTrack.source,
          trackId: body.trackId,
        });
        res.json({ leg: toLegDto(updatedFromTrack) });
        return;
      }

      const waypoints = body.waypoints ?? null;
      if (waypoints) {
        const head = { lat: waypoints[0][1], lon: waypoints[0][0] };
        const tail = {
          lat: waypoints[waypoints.length - 1][1],
          lon: waypoints[waypoints.length - 1][0],
        };
        if (
          haversineKm(head, fromCoord) > ANCHOR_TOLERANCE_KM ||
          haversineKm(tail, toCoord) > ANCHOR_TOLERANCE_KM
        ) {
          throw new AppError(
            "The line must start and end at the leg's stops (anchor tolerance 1 km)",
            400,
          );
        }
      }

      const updated = await prisma.tripRouteLeg.update({
        where: { id: leg.id },
        data: {
          source: body.source,
          mode: body.mode ?? leg.mode,
          // A line the user drew is the best information available; a chord
          // is a placeholder.
          confidence: body.source === "drawn" ? "high" : "low",
          waypoints:
            waypoints === null
              ? Prisma.DbNull
              : (waypoints as unknown as Prisma.InputJsonValue),
          // `drivingMinutes`/`tollCost`/`currency` are `.nullable().optional()`
          // in `legOverrideSchema` — a client may send an explicit `null` to
          // CLEAR one of them. `body.x ?? leg.x` cannot tell "absent" from
          // "present and null" apart (both are nullish), so it would silently
          // keep the old value on a clear request. Zod omits an absent
          // optional key entirely, so `in` is the reliable discriminator.
          drivingMinutes: "drivingMinutes" in body ? body.drivingMinutes ?? null : leg.drivingMinutes,
          tollCost: "tollCost" in body ? body.tollCost ?? null : leg.tollCost,
          currency: "currency" in body ? body.currency ?? null : leg.currency,
          distanceKm: legDistanceKm({
            source: body.source,
            from: fromCoord,
            to: toCoord,
            waypoints,
          }),
        },
      });

      logger.info({ operation: "tour.leg.override", legId: updated.id, source: updated.source });
      res.json({ leg: toLegDto(updated) });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE the override — back to a straight chord. */
router.delete(
  "/trips/:id/routes/:routeId/legs/:fromStopId/:toStopId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);

      const leg = await findLegOrThrow(routeId, req.params.fromStopId, req.params.toStopId);
      const fromCoord = requireCoords(leg.fromStop, "from");
      const toCoord = requireCoords(leg.toStop, "to");

      await prisma.tripRouteLeg.update({
        where: { id: leg.id },
        data: {
          source: "straight",
          confidence: "low",
          waypoints: Prisma.DbNull,
          distanceKm: legDistanceKm({
            source: "straight",
            from: fromCoord,
            to: toCoord,
          }),
        },
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

/**
 * True iff `value` is a usable `[[lon, lat], ...]` polyline: an array of
 * two-element numeric tuples. `waypoints` is a `Json?` column, so it can
 * hold whatever was last written to it — `Array.isArray` alone would wave
 * a malformed value through and hand the map `NaN` coordinates. Same guard
 * shape as `shared/cruise/legRouteKey.ts`'s `isCoordinatePolyline`, kept
 * local here rather than shared because the two domains have no other
 * coupling.
 */
function isCoordinatePolyline(value: unknown): value is Array<[number, number]> {
  if (!Array.isArray(value)) return false;
  return value.every(
    (point) =>
      Array.isArray(point) &&
      point.length === 2 &&
      typeof point[0] === "number" &&
      typeof point[1] === "number",
  );
}

/**
 * The chord a straight leg's distance was computed from: the two endpoint
 * stops, in GeoJSON `[lon, lat]` order. Returns `null` if either stop lost
 * its coordinates (see `requireCoords` above for why that can only happen
 * to data written outside this codebase's own write paths).
 */
function chordCoordinates(
  from: { lat: number | null; lon: number | null },
  to: { lat: number | null; lon: number | null },
): Array<[number, number]> | null {
  if (from.lat === null || from.lon === null || to.lat === null || to.lon === null) return null;
  return [
    [from.lon, from.lat],
    [to.lon, to.lat],
  ];
}

/**
 * GET /trips/:id/routes/:routeId/geometry
 *
 * One LineString per leg, so the map can colour each leg by its own mode
 * and dash the straight ones. A leg with stored waypoints emits them; a
 * leg without emits its two endpoint coordinates — exactly the chord its
 * `distanceKm` was computed from, so the picture and the number agree as
 * long as both endpoints still have coordinates. The write paths refuse to
 * let that happen (see `requireCoords` above), so `chordCoordinates`
 * returning `null` here is a backstop, not an expected case — if it ever
 * fires, the leg is dropped from the FeatureCollection while its
 * `distanceKm` still counts toward the section total, which is the one way
 * this promise could still be broken.
 *
 * Ordered by `fromStop.routeOrderIdx` IN THE QUERY, the same clause the
 * stops endpoint in `tourRoutes.ts` already uses — no JS re-sort needed
 * once the database does the ordering.
 */
router.get(
  "/trips/:id/routes/:routeId/geometry",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);

      const legs = await prisma.tripRouteLeg.findMany({
        where: { routeId },
        orderBy: { fromStop: { routeOrderIdx: "asc" } },
        include: {
          fromStop: { select: { lat: true, lon: true } },
          toStop: { select: { lat: true, lon: true } },
        },
      });

      const features = legs.flatMap((leg) => {
        const coordinates = isCoordinatePolyline(leg.waypoints)
          ? leg.waypoints
          : chordCoordinates(leg.fromStop, leg.toStop);
        if (!coordinates) return [];
        return [
          {
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates },
            properties: {
              legId: leg.id,
              source: leg.source,
              mode: leg.mode,
              distanceKm: leg.distanceKm,
              confidence: leg.confidence,
            },
          },
        ];
      });

      res.json({ type: "FeatureCollection", features });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
