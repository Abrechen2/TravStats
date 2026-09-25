import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import {
  CRUISE_TRACK_SOURCES,
  cruiseTrackUploadFieldsSchema,
  pullCruiseDawarichSchema,
} from "../../schemas/cruise";
import { handleGpxUpload } from "../trips/tourTracks";
import { parseTrackFile } from "../../services/tour/tracks/parseTrackFile";
import { ingestTrack, type IngestedTrack } from "../../services/tour/tracks/ingestTrack";
import { ingestedTrackColumns, isDuplicateExternalRef } from "../../services/tour/tracks/trackRow";
import {
  EmptyDawarichWindowError,
  pullDawarichWindow,
} from "../../services/tour/tracks/pullDawarichTrack";
import { splitAtLongSteps } from "../../services/trackCoverage/splitAtLongSteps";
import { CRUISE_TRACK_GAP_KM } from "../../services/trackCoverage/legCoverage";
import { recomputeLegsForCruise } from "../../services/cruiseDistance/cruiseLegService";
import { loadCruiseTrackOverview } from "../../services/cruise/cruiseTrackOverview";
import { createDawarichClient } from "../../services/dawarich/dawarichClient";
import { getDawarichConnection } from "../../services/dawarich/dawarichResolver";
import { DawarichError } from "../../services/dawarich/errors";
import logger from "../../utils/logger";
import type { ParsedTrack } from "../../services/tour/tracks/parseGpx";

/**
 * Recorded tracks of a cruise (2.7) — `GET`/`POST`/`DELETE
 * /api/v1/cruises/:id/tracks…`. Mounted at the same prefix as the main cruises
 * router, the pattern `routeOverride.ts` set.
 *
 * A recording hangs off the cruise, never off a leg (see `CruiseTrack` in
 * schema.prisma); which legs it covers is decided on every read. Each write
 * recomputes the cruise's legs in the SAME transaction, so the kilometres in
 * the statistics never disagree with the line on the map, even for a moment.
 *
 * The pipeline is the tour one — `parseTrackFile` → `ingestTrack` →
 * `ingestedTrackColumns` — with one step added: `splitAtLongSteps` marks the
 * hours a phone at sea had no signal as holes before anything is measured.
 */

const router = Router();
router.use(authenticate);
// Method-aware: a read-only token may list, never upload or delete.
router.use(requireWriteScope);

const trackSource = z.enum(CRUISE_TRACK_SOURCES);

function markSeaHoles(parsed: ParsedTrack): ParsedTrack {
  return splitAtLongSteps(parsed, CRUISE_TRACK_GAP_KM);
}

/** Owner check. A cruise of another user answers exactly like a missing one. */
async function requireOwnedCruise(cruiseId: string, userId: string): Promise<void> {
  const owned = await prisma.cruise.findFirst({
    where: { id: cruiseId, userId },
    select: { id: true },
  });
  if (!owned) throw new AppError("Cruise not found", 404);
}

/**
 * The columns a cruise recording keeps. Climb and moving time are dropped on
 * purpose: at sea they measure a ship's swell and a ship's clock.
 */
function cruiseTrackColumns(ingested: IngestedTrack) {
  const { startedAt, endedAt, geometry, segmentStarts, cumulativeKm, pointCount, distanceKm } =
    ingestedTrackColumns(ingested);
  return { startedAt, endedAt, geometry, segmentStarts, cumulativeKm, pointCount, distanceKm };
}

async function storeTrack(
  cruiseId: string,
  data: ReturnType<typeof cruiseTrackColumns> & {
    source: string;
    name: string | null;
    externalRef: string | null;
    truncated: boolean;
  }
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const track = await tx.cruiseTrack.create({
      data: { cruiseId, ...data, source: trackSource.parse(data.source) },
      select: { id: true },
    });
    await recomputeLegsForCruise(cruiseId, tx);
    return track;
  });
}

/**
 * GET /cruises/:id/tracks — the recordings (metadata only, never the line:
 * a recording is location history, and a list call is not the place to ship
 * it) and, per leg, where its line comes from and what the recordings say
 * about it. One call gives the cruise page everything it shows.
 */
router.get("/:id/tracks", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const overview = await loadCruiseTrackOverview(req.params.id, req.userId!);
    if (!overview) throw new AppError("Cruise not found", 404);
    res.json({ success: true, data: overview });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /cruises/:id/tracks — multipart, one GPX/TCX/FIT file under `file`.
 * `rejectDemo` sits above the upload on purpose: a refusal below multer would
 * already have read the body (see `routes/trips/tourTracks.ts`).
 */
router.post(
  "/:id/tracks",
  rejectDemo,
  handleGpxUpload,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const cruiseId = req.params.id;
      await requireOwnedCruise(cruiseId, userId);

      if (!req.file) throw new AppError("No track file uploaded", 400);
      const fields = cruiseTrackUploadFieldsSchema.safeParse(req.body ?? {});
      if (!fields.success) throw new AppError(fields.error.message, 400);

      const file = await parseTrackFile(req.file.buffer, req.file.originalname);
      if (!file) throw new AppError("The file could not be read as GPX, TCX or FIT", 400);

      const ingested = ingestTrack(markSeaHoles(file.track));
      if (!ingested) {
        throw new AppError("This recording has no timestamps, so it cannot be placed in time", 400);
      }

      let track: { id: string };
      try {
        track = await storeTrack(cruiseId, {
          ...cruiseTrackColumns(ingested),
          source: fields.data.origin ?? file.format,
          name: file.track.name,
          externalRef: fields.data.externalRef ?? null,
          truncated: false,
        });
      } catch (error) {
        if (isDuplicateExternalRef(error)) {
          throw new AppError("This recording has already been imported into this cruise", 409);
        }
        throw error;
      }

      logger.info({
        operation: "cruise.track.create",
        cruiseId,
        trackId: track.id,
        pointCount: ingested.pointCount,
      });
      res.status(201).json({ success: true, data: { id: track.id } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /cruises/:id/tracks/dawarich — pull one leg's window (`legOrdinal`) or
 * the whole voyage from the caller's Dawarich. The failure vocabulary is the
 * tour pull's: `notConfigured` and the fixed Dawarich kinds as `{ error }`, an
 * empty window as a plain 409 — all 409, see `routes/trips/tourTracks.ts`.
 */
router.post("/:id/tracks/dawarich", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const cruiseId = req.params.id;
    const body = pullCruiseDawarichSchema.safeParse(req.body ?? {});
    if (!body.success) throw new AppError(body.error.message, 400);

    const overview = await loadCruiseTrackOverview(cruiseId, userId);
    if (!overview) throw new AppError("Cruise not found", 404);

    const { legOrdinal } = body.data;
    let derived = overview.window;
    if (legOrdinal !== undefined) {
      const leg = overview.legs.find((l) => l.ordinal === legOrdinal);
      if (!leg) throw new AppError("This cruise has no such leg", 404);
      derived = leg.window;
    }
    const startAt = body.data.startedAt ?? (derived ? new Date(derived.startAt) : null);
    const endAt = body.data.endedAt ?? (derived ? new Date(derived.endAt) : null);
    if (startAt === null || endAt === null) {
      throw new AppError(
        "This cruise has no dates to derive a time window from — provide startedAt/endedAt",
        400
      );
    }
    if (startAt.getTime() > endAt.getTime()) {
      throw new AppError("The resolved time window is invalid (end before start)", 400);
    }

    const connection = await getDawarichConnection(userId);
    if (!connection) {
      res.status(409).json({
        success: false,
        error: "notConfigured",
        message: "No Dawarich connection configured",
      });
      return;
    }

    let pulled;
    try {
      pulled = await pullDawarichWindow(
        createDawarichClient(connection),
        { startAt, endAt },
        markSeaHoles
      );
    } catch (error) {
      if (error instanceof DawarichError) {
        res.status(409).json({ success: false, error: error.kind, message: error.message });
        return;
      }
      if (error instanceof EmptyDawarichWindowError) throw new AppError(error.message, 409);
      throw error;
    }

    const track = await storeTrack(cruiseId, {
      ...cruiseTrackColumns(pulled.ingested),
      source: "dawarich",
      name: null,
      externalRef: null,
      truncated: pulled.truncated,
    });

    logger.info({
      operation: "cruise.track.pullDawarich",
      cruiseId,
      trackId: track.id,
      legOrdinal: legOrdinal ?? null,
      pointCount: pulled.ingested.pointCount,
      truncated: pulled.truncated,
    });
    res.status(201).json({ success: true, data: { id: track.id } });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /cruises/:id/tracks/:trackId — the legs it carried fall back to the
 * drawn line, the sea route or the chord in the same transaction.
 */
router.delete(
  "/:id/tracks/:trackId",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const cruiseId = req.params.id;
      await requireOwnedCruise(cruiseId, userId);

      // Scoped by BOTH ids: a track id lifted from another cruise — another
      // user's included — deletes nothing and answers 404.
      const deleted = await prisma.$transaction(async (tx) => {
        const result = await tx.cruiseTrack.deleteMany({
          where: { id: req.params.trackId, cruiseId },
        });
        if (result.count > 0) await recomputeLegsForCruise(cruiseId, tx);
        return result.count;
      });
      if (deleted === 0) throw new AppError("Track not found", 404);

      logger.info({ operation: "cruise.track.delete", cruiseId, trackId: req.params.trackId });
      res.json({ success: true, data: { deleted } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
