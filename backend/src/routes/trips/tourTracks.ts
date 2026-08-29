import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { FILE_LIMITS } from "../../config/constants";
import { TRACK_SOURCES } from "../../schemas/tour";
import { parseGpx } from "../../services/tour/tracks/parseGpx";
import { ingestTrack } from "../../services/tour/tracks/ingestTrack";
import { resolveTrip } from "../trips";
import { resolveRoute } from "./tourRoutes";
import logger from "../../utils/logger";

/**
 * Recorded tracks for a tour route section (Phase 3b, task 4) — split out
 * as its own same-prefix satellite router, the pattern `tourLegs.ts` and
 * `tourRouting.ts` already use. Mounted at the SAME `/trips` prefix as
 * those, LAST among the tour satellites (see `mounts.ts`).
 *
 * A track hangs off the SECTION and a time window, never a leg — see the
 * `TripRouteTrack` model's own doc comment in schema.prisma. This router
 * only stores it; adopting a segment of it onto a leg is a separate,
 * explicit action (task 5, not built here).
 *
 * **Middleware is PER ROUTE, never `router.use()`** — a router-level
 * `authenticate` here would swallow every LATER `/api/v1` mount's requests,
 * exactly the phase-1 bug that 401'd the public pairing endpoints. See the
 * regression test in `__tests__/tourTracks.test.ts`.
 */

const router = Router();

/**
 * `multer.memoryStorage()`, deliberately NOT a new `diskStorage` instance in
 * `middleware/upload.ts`. A GPX file has no life after parsing — only the
 * simplified geometry is persisted, as a database column — so writing it to
 * disk would create a seventh upload directory that would then need
 * registering in `BACKED_UP_UPLOAD_DIRS` (`config/uploadDirs.ts` — the list
 * that once held three of six and silently left users' photos out of every
 * backup) and would leave raw location history on disk with a cleanup path
 * nobody asked for.
 */
const gpxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FILE_LIMITS.GPX_TRACK_MAX_SIZE },
});

/**
 * Wraps `gpxUpload.single(...)` manually — same shape as
 * `routes/settings/profilePicture.ts` — so an oversized (or otherwise
 * rejected) upload surfaces as a normal 400 `AppError` instead of falling
 * through to the generic 500 path the shared errorHandler uses for an
 * unrecognised `MulterError`.
 */
function handleGpxUpload(req: Request, res: Response, next: NextFunction): void {
  gpxUpload.single("file")(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        const maxMb = FILE_LIMITS.GPX_TRACK_MAX_SIZE / (1024 * 1024);
        return next(new AppError(`GPX file too large — maximum size is ${maxMb} MB`, 400));
      }
      const message = err instanceof Error ? err.message : "Upload failed";
      return next(new AppError(message, 400));
    }
    next();
  });
}

/**
 * Write-side boundary check on `TripRouteTrack.source` — same reasoning as
 * `acceptedLegSource` in `routes/trips/tourRouting.ts`: this endpoint only
 * ever writes the literal `"gpx"` below, so this can never actually fail
 * today. It is cheap insurance against a future change silently writing a
 * value this column isn't meant to hold, rather than an `as` cast past the
 * `any`-forbidden rule.
 */
const trackSource = z.enum(TRACK_SOURCES);

interface TrackMetaRow {
  id: string;
  routeId: string;
  source: string;
  name: string | null;
  startedAt: Date;
  endedAt: Date;
  pointCount: number;
  distanceKm: number;
  createdAt: Date;
}

interface TrackRow extends TrackMetaRow {
  geometry: Prisma.JsonValue;
}

/**
 * Selected explicitly — NEVER `include`d and stripped later. A track is
 * location history: shipping its geometry on a list call means megabytes
 * per request and puts a user's movements into a response an intermediary
 * might cache.
 */
const TRACK_META_SELECT = {
  id: true,
  routeId: true,
  source: true,
  name: true,
  startedAt: true,
  endedAt: true,
  pointCount: true,
  distanceKm: true,
  createdAt: true,
} as const;

function toTrackMetaDto(track: TrackMetaRow): Record<string, unknown> {
  return {
    id: track.id,
    routeId: track.routeId,
    source: track.source,
    name: track.name,
    startedAt: track.startedAt,
    endedAt: track.endedAt,
    pointCount: track.pointCount,
    distanceKm: track.distanceKm,
    createdAt: track.createdAt,
  };
}

function toTrackDto(track: TrackRow): Record<string, unknown> {
  return { ...toTrackMetaDto(track), geometry: track.geometry };
}

/** Track must exist AND belong to this route (which `resolveRoute` already tied to this user). */
async function resolveTrack(routeId: string, trackId: string): Promise<TrackRow> {
  const track = await prisma.tripRouteTrack.findFirst({ where: { id: trackId, routeId } });
  if (!track) throw new AppError("Track not found", 404);
  return track;
}

/**
 * POST /trips/:id/routes/:routeId/tracks
 *
 * multipart/form-data, one GPX file under the field name "file". Pipeline:
 * `parseGpx` -> `ingestTrack` -> store. The two `null` cases are DIFFERENT
 * user-facing failures and must not collapse into one message: `parseGpx`
 * returning `null` means the file could not be read as GPX at all (broken
 * or unrelated XML); `ingestTrack` returning `null` means the file parsed
 * fine but has no timestamps, so it cannot be placed in time. One is "wrong
 * or broken file", the other is "valid file we cannot use yet".
 */
router.post(
  "/trips/:id/routes/:routeId/tracks",
  authenticate,
  requireWriteScope,
  handleGpxUpload,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);

      if (!req.file) {
        throw new AppError("No GPX file uploaded", 400);
      }

      const xml = req.file.buffer.toString("utf-8");
      const parsed = parseGpx(xml);
      if (!parsed) {
        throw new AppError("The file could not be read as GPX", 400);
      }

      const ingested = ingestTrack(parsed);
      if (!ingested) {
        throw new AppError(
          "This GPX file has no timestamps, so it cannot be placed in time",
          400,
        );
      }

      const source = trackSource.parse("gpx");
      const track = await prisma.tripRouteTrack.create({
        data: {
          routeId,
          source,
          name: parsed.name,
          startedAt: ingested.startedAt,
          endedAt: ingested.endedAt,
          geometry: ingested.geometry as unknown as Prisma.InputJsonValue,
          pointCount: ingested.pointCount,
          distanceKm: ingested.distanceKm,
        },
      });

      logger.info({
        operation: "tour.track.create",
        trackId: track.id,
        routeId,
        source,
        pointCount: track.pointCount,
      });
      res.status(201).json({ track: toTrackDto(track) });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /trips/:id/routes/:routeId/tracks
 *
 * Metadata only — no `geometry` key at all, not merely an empty one. See
 * `TRACK_META_SELECT`'s doc comment for why.
 */
router.get(
  "/trips/:id/routes/:routeId/tracks",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);

      const tracks = await prisma.tripRouteTrack.findMany({
        where: { routeId },
        orderBy: { startedAt: "asc" },
        select: TRACK_META_SELECT,
      });

      res.json({ tracks: tracks.map(toTrackMetaDto) });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /trips/:id/routes/:routeId/tracks/:trackId — WITH geometry. */
router.get(
  "/trips/:id/routes/:routeId/tracks/:trackId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);
      const track = await resolveTrack(routeId, req.params.trackId);

      res.json({ track: toTrackDto(track) });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /trips/:id/routes/:routeId/tracks/:trackId */
router.delete(
  "/trips/:id/routes/:routeId/tracks/:trackId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const routeId = await resolveRoute(userId, trip.id, req.params.routeId);
      await resolveTrack(routeId, req.params.trackId);

      await prisma.tripRouteTrack.delete({ where: { id: req.params.trackId } });

      logger.info({ operation: "tour.track.delete", trackId: req.params.trackId, routeId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
