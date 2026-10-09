import { Router, Response, NextFunction } from "express";
import { Prisma } from "../../prisma";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { legOverrideSchema } from "../../schemas/tour";
import { legDistanceKm } from "../../services/tour/tourDistance";
import { adoptSegment, ANCHOR_TOLERANCE_KM } from "../../services/tour/tracks/adoptTrack";
import { haversineKm } from "../../shared/geo/haversine";
import logger from "../../utils/logger";
import { resolveRouteFromRequest, toLegDto } from "./tourRoutes";
import { resolveTrack } from "./tourTracks";
import { isCoordinatePolyline, readStoredTrack } from "../../services/trackCoverage/storedTrack";
import { tourLegVerdict } from "../../services/trackCoverage/legCoverage";
import { applyLegToll, touchesToll } from "../../services/expenses/legToll";
import { toExpenseDto } from "../../services/expenses/expenseDto";

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
  toStopId: string
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
  which: "from" | "to"
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
  [
    "/trips/:id/routes/:routeId/legs/:fromStopId/:toStopId",
    "/tours/:routeId/legs/:fromStopId/:toStopId",
  ],
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRouteFromRequest(userId, req);
      const body = legOverrideSchema.parse(req.body);

      const leg = await findLegOrThrow(routeId, req.params.fromStopId, req.params.toStopId);
      const fromCoord = requireCoords(leg.fromStop, "from");
      const toCoord = requireCoords(leg.toStop, "to");

      if (body.source === "track") {
        // `resolveTrack` 404s if `trackId` doesn't belong to THIS route —
        // a track id lifted from another route (another user's, or even
        // a different section of this trip) must not adopt.
        const track = await resolveTrack(routeId, body.trackId);
        const stored = readStoredTrack(track);
        const adoption = adoptSegment(stored.geometry, fromCoord, toCoord, {
          maxAnchorKm: ANCHOR_TOLERANCE_KM,
          // Measure against the raw track rather than the simplified line it
          // was stored as — see `adoptTrack` (AUD-034).
          cumulativeKm: stored.cumulativeKm,
          segmentStarts: stored.segmentStarts,
        });
        if (!adoption) {
          throw new AppError(
            `This track doesn't come within ${ANCHOR_TOLERANCE_KM} km of both of this leg's ` +
              "stops — it likely covers a different day or place. Not adopted; the leg is unchanged.",
            409,
            "TRACK_DOES_NOT_COVER_LEG"
          );
        }
        // The recording stopped somewhere between these two stops. The distance
        // would correctly leave the gap out while the line drawn on the map ran
        // straight across it — a leg that is part measurement and part guess,
        // stored as `confidence: high`. Refused instead (AUD-033).
        if (adoption.spansRecordingGap) {
          throw new AppError(
            "The recording stops and restarts between this leg's two stops, so part of the " +
              "way was never recorded. Not adopted; the leg is unchanged.",
            409,
            "TRACK_GAP_IN_LEG"
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
            `The line must start and end at the leg's stops (anchor tolerance ${ANCHOR_TOLERANCE_KM} km)`,
            400
          );
        }
      }

      // The leg and its toll expense change together or not at all: a toll
      // refused (409, several on the leg) must not leave the line changed.
      const { updated, toll } = await prisma.$transaction(async (tx) => {
        const updatedLeg = await tx.tripRouteLeg.update({
          where: { id: leg.id },
          data: {
            source: body.source,
            mode: body.mode ?? leg.mode,
            // A line the user drew is the best information available; a chord
            // is a placeholder.
            confidence: body.source === "drawn" ? "high" : "low",
            waypoints:
              waypoints === null ? Prisma.DbNull : (waypoints as unknown as Prisma.InputJsonValue),
            // `drivingMinutes` is `.nullable().optional()` in `legOverrideSchema`
            // — a client may send an explicit `null` to CLEAR it. `body.x ?? leg.x`
            // cannot tell "absent" from "present and null" apart (both are
            // nullish), so it would silently keep the old value on a clear
            // request. Zod omits an absent optional key entirely, so `in` is the
            // reliable discriminator.
            drivingMinutes:
              "drivingMinutes" in body ? (body.drivingMinutes ?? null) : leg.drivingMinutes,
            distanceKm: legDistanceKm({
              source: body.source,
              from: fromCoord,
              to: toCoord,
              waypoints,
            }),
          },
        });
        // `tollCost` / `currency` live on the leg's toll EXPENSE since
        // forgejo#140; see `applyLegToll` for the exact mapping.
        const legToll = touchesToll(body)
          ? await applyLegToll(
              tx,
              {
                userId,
                routeId,
                fromStopId: req.params.fromStopId,
                toStopId: req.params.toStopId,
              },
              body
            )
          : undefined;
        return { updated: updatedLeg, toll: legToll };
      });

      logger.info({ operation: "tour.leg.override", legId: updated.id, source: updated.source });
      res.json({
        leg: toLegDto(updated),
        // Present only when the body carried `tollCost` or `currency`.
        ...(toll !== undefined ? { toll: toll ? toExpenseDto(toll) : null } : {}),
      });
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE the override — back to a straight chord. */
router.delete(
  [
    "/trips/:id/routes/:routeId/legs/:fromStopId/:toStopId",
    "/tours/:routeId/legs/:fromStopId/:toStopId",
  ],
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRouteFromRequest(userId, req);

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
  }
);

/**
 * The chord a straight leg's distance was computed from: the two endpoint
 * stops, in GeoJSON `[lon, lat]` order. Returns `null` if either stop lost
 * its coordinates (see `requireCoords` above for why that can only happen
 * to data written outside this codebase's own write paths).
 */
function chordCoordinates(
  from: { lat: number | null; lon: number | null },
  to: { lat: number | null; lon: number | null }
): Array<[number, number]> | null {
  if (from.lat === null || from.lon === null || to.lat === null || to.lon === null) return null;
  return [
    [from.lon, from.lat],
    [to.lon, to.lat],
  ];
}

export interface RouteGeometryFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Array<[number, number]> };
  properties: {
    legId: string;
    source: string;
    mode: string;
    distanceKm: number;
    confidence: string;
  };
}

export interface RouteGeometryFeatureCollection {
  type: "FeatureCollection";
  features: RouteGeometryFeature[];
}

/**
 * Assemble one section's legs into the GeoJSON FeatureCollection
 * `GET .../geometry` below returns. Extracted so
 * `routes/trips/tourIndex.ts`'s dashboard-wide batch endpoint can reuse
 * the exact same waypoints/chord-fallback logic instead of a second,
 * possibly-drifting assembler — the same relationship
 * `routes/cruises.ts`'s `buildCruiseGeometry` has to its own per-cruise
 * and batch endpoints.
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
 * once the database does the ordering. Callers are trusted to have already
 * checked ownership of `routeId` — this function itself does not.
 */
export async function buildRouteGeometry(routeId: string): Promise<RouteGeometryFeatureCollection> {
  const legs = await prisma.tripRouteLeg.findMany({
    where: { routeId },
    orderBy: { fromStop: { routeOrderIdx: "asc" } },
    include: {
      fromStop: { select: { lat: true, lon: true } },
      toStop: { select: { lat: true, lon: true } },
    },
  });

  const features: RouteGeometryFeature[] = legs.flatMap((leg) => {
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

  return { type: "FeatureCollection", features };
}

/**
 * GET /trips/:id/routes/:routeId/legs/track-coverage
 *
 * Per leg, which of the section's recordings covers it — or why none does.
 * The editor offers the `track` source exactly where this says `covered`, and
 * the verdict is `adoptSegment`'s own acceptance (`services/trackCoverage/
 * legCoverage.ts`), so the offer and the 409 of `PUT …/legs/…` can no longer
 * disagree. Until 2.7 the browser decided this with its own copy of the
 * anchor tolerance after fetching every track's full geometry; one request
 * here replaces that, and the second copy of the rule is gone.
 *
 * One segment after `/legs`, so it never collides with the two-segment
 * `/legs/:fromStopId/:toStopId` paths above.
 */
router.get(
  ["/trips/:id/routes/:routeId/legs/track-coverage", "/tours/:routeId/legs/track-coverage"],
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRouteFromRequest(userId, req);
      const [legs, tracks] = await Promise.all([
        prisma.tripRouteLeg.findMany({
          where: { routeId },
          select: {
            id: true,
            fromStopId: true,
            toStopId: true,
            fromStop: { select: { lat: true, lon: true } },
            toStop: { select: { lat: true, lon: true } },
          },
        }),
        prisma.tripRouteTrack.findMany({
          where: { routeId },
          // Oldest first: the editor's choice among several covering
          // recordings has always been the earliest one.
          orderBy: { startedAt: "asc" },
          select: { id: true, geometry: true, segmentStarts: true, cumulativeKm: true },
        }),
      ]);
      const stored = tracks.map((t) => ({ id: t.id, track: readStoredTrack(t) }));

      const coverage = legs.map((leg) => {
        const { fromStop, toStop } = leg;
        const coords =
          fromStop.lat !== null &&
          fromStop.lon !== null &&
          toStop.lat !== null &&
          toStop.lon !== null
            ? {
                from: { lat: fromStop.lat, lon: fromStop.lon },
                to: { lat: toStop.lat, lon: toStop.lon },
              }
            : null;
        return {
          legId: leg.id,
          fromStopId: leg.fromStopId,
          toStopId: leg.toStopId,
          verdict: coords === null ? null : tourLegVerdict(stored, coords.from, coords.to),
        };
      });

      res.json({ coverage });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /trips/:id/routes/:routeId/geometry
 *
 * Thin wrapper around {@link buildRouteGeometry} once ownership of
 * `routeId` is established.
 */
router.get(
  ["/trips/:id/routes/:routeId/geometry", "/tours/:routeId/geometry"],
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRouteFromRequest(userId, req);
      res.json(await buildRouteGeometry(routeId));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
