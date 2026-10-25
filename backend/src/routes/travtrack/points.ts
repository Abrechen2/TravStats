import { Router, type NextFunction, type Response } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { flightDeviceDataLimiter } from "../../middleware/rateLimit";
import {
  LOCATION_MAX_BODY_BYTES,
  travTrackPointsQuerySchema,
  travTrackRangeQuerySchema,
  travTrackSummaryQuerySchema,
  travTrackUploadSchema,
} from "../../schemas/travtrack";
import { deleteTravTrackRange } from "../../services/travtrack/deleteRange";
import { ingestTravTrackPoints } from "../../services/travtrack/ingest";
import { lastSeen } from "../../services/travtrack/lastSeen";
import { resolveSpan } from "../../services/travtrack/range";
import logger from "../../utils/logger";
import { travTrackTier } from "./gate";
import { entriesOfPoints } from "./pointEntries";

/**
 * TravTrack's points (TravTrack plan T3): a paired Companion sends positions,
 * the owner reads them a page at a time, sees a summary and deletes by span.
 * Bare responses (ADR 0001). Private to the owner: nothing here is part of
 * sharing, a `.travstats` file, a public link, a comparison or federation.
 *
 * `POST` does NOT consult the account's location provider (rule 2, review
 * focus 7): points the phone queued for TravTrack before a switch away from
 * it are accepted while the instance takes points at all. Nor does it read
 * the trip-recording switch — that governs `/trips/:id/recording`.
 */

const router = Router();

function route(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}

/**
 * POST /travtrack/points — `{ uploadId, points: [...], gaps?: [...] }`.
 *   - only a paired device may send (403 TRAVTRACK_DEVICE_REQUIRED)
 *   - the same uploadId with the same content → 200, the stored answer, `replayed: true`
 *   - the same uploadId with other content → 409 RECORDING_UPLOAD_ID_REUSED
 *   - otherwise 201: every point has an outcome, all of them final for the client
 */
router.post(
  "/travtrack/points",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  flightDeviceDataLimiter,
  route(async (req, res) => {
    // The header first (cheap), then the parsed body itself: a chunked
    // request carries no Content-Length.
    if (
      Number(req.get("content-length") ?? 0) > LOCATION_MAX_BODY_BYTES ||
      Buffer.byteLength(JSON.stringify(req.body ?? null)) > LOCATION_MAX_BODY_BYTES
    ) {
      throw new AppError("The upload is too large", 413, "TRACK_BODY_TOO_LARGE");
    }
    const deviceId = req.apiToken?.deviceId;
    if (!deviceId) {
      throw new AppError("Positions are sent by a paired device", 403, "TRAVTRACK_DEVICE_REQUIRED");
    }
    const body = travTrackUploadSchema.parse(req.body);
    const { result, replayed } = await ingestTravTrackPoints({
      userId: req.userId!,
      deviceId,
      uploadId: body.uploadId,
      points: body.points,
      gaps: body.gaps,
    });
    if (!replayed) {
      logger.info({
        operation: "travtrack.points.ingest",
        uploadId: result.uploadId,
        stored: result.stored,
        duplicate: result.duplicate,
        dropped: result.dropped,
        linked: result.linked,
        unlinked: result.unlinked,
        gapsStored: result.gapsStored,
      });
    }
    res.status(replayed ? 200 : 201).json({ ...result, replayed });
  })
);

/**
 * GET /travtrack/points?from&to&cursor&limit — the points of a span, oldest
 * first by (t, seq). `nextCursor` is set while more remain: a page is never
 * silently the whole span.
 */
router.get(
  "/travtrack/points",
  authenticate,
  travTrackTier("on"),
  route(async (req, res) => {
    const userId = req.userId!;
    const q = travTrackPointsQuerySchema.parse(req.query);
    const after = q.cursor?.split(":");
    const afterT = after ? new Date(Number(after[0])) : null;
    const afterSeq = after ? BigInt(after[1]) : null;
    const rows = await prisma.travTrackPoint.findMany({
      where: {
        userId,
        t: { gte: new Date(q.from), lt: new Date(q.to) },
        ...(afterT && afterSeq !== null
          ? { OR: [{ t: { gt: afterT } }, { t: afterT, seq: { gt: afterSeq } }] }
          : {}),
      },
      orderBy: [{ t: "asc" }, { seq: "asc" }],
      take: q.limit + 1,
      select: {
        id: true,
        seq: true,
        t: true,
        lat: true,
        lon: true,
        accuracyM: true,
        altitudeM: true,
        speedMps: true,
        course: true,
        motion: true,
        deviceId: true,
        purpose: true,
      },
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const entries = await entriesOfPoints(
      userId,
      page.map((p) => p.id)
    );
    res.json({
      points: page.map((p) => ({
        id: p.id,
        t: p.t.toISOString(),
        lat: p.lat,
        lon: p.lon,
        accuracy: p.accuracyM,
        altitude: p.altitudeM,
        speed: p.speedMps,
        course: p.course,
        motion: p.motion,
        deviceId: p.deviceId,
        purpose: p.purpose,
        entries: entries.get(p.id) ?? [],
      })),
      nextCursor: rows.length > q.limit && last ? `${last.t.getTime()}:${last.seq}` : null,
    });
  })
);

/** The file names of the imports among these devices (`file:<importId>`). */
async function fileNamesOf(userId: string, deviceIds: Array<string | null>) {
  const ids = deviceIds.flatMap((d) => (d?.startsWith("file:") ? [d.slice(5)] : []));
  if (ids.length === 0) return new Map<string, string>();
  const rows = await prisma.travTrackImport.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, fileName: true },
  });
  return new Map(rows.map((r) => [`file:${r.id}`, r.fileName]));
}

/**
 * GET /travtrack/summary — how much is stored, from when to when, from which
 * devices. With a span (named like a delete) it is that span's summary: the
 * preview a delete dialog names its count from.
 */
router.get(
  "/travtrack/summary",
  authenticate,
  travTrackTier("held"),
  route(async (req, res) => {
    const userId = req.userId!;
    const q = travTrackSummaryQuerySchema.parse(req.query);
    const span =
      q.from !== undefined || q.fromDay !== undefined ? await resolveSpan(userId, q) : null;
    const where = span ? { userId, t: { gte: span.from, lt: span.to } } : { userId };
    const [agg, devices, deletedRanges, zones] = await Promise.all([
      prisma.travTrackPoint.aggregate({
        where,
        _count: { _all: true },
        _min: { t: true },
        _max: { t: true, createdAt: true },
      }),
      prisma.travTrackPoint.groupBy({
        by: ["deviceId"],
        where,
        _count: { _all: true },
      }),
      prisma.travTrackDeletedRange.count({ where: { userId } }),
      prisma.travTrackPrivacyZone.count({ where: { userId } }),
    ]);
    const files = await fileNamesOf(
      userId,
      devices.map((d) => d.deviceId)
    );
    res.json({
      pointCount: agg._count._all,
      firstAt: agg._min.t?.toISOString() ?? null,
      lastAt: agg._max.t?.toISOString() ?? null,
      lastReceivedAt: agg._max.createdAt?.toISOString() ?? null,
      devices: devices
        .map((d) => ({
          deviceId: d.deviceId,
          pointCount: d._count._all,
          fileName: (d.deviceId && files.get(d.deviceId)) ?? null,
        }))
        .sort((a, b) => b.pointCount - a.pointCount),
      deletedRanges,
      zones,
    });
  })
);

/**
 * GET /travtrack/last-seen — „Zuletzt gesehen" (TravTrack plan L2): the
 * newest real, privacy-safe fix of the own history, or `{ lastSeen: null }`.
 * Tier `on`: a view. The owner's alone, and `no-store` like all of `/api`.
 */
router.get(
  "/travtrack/last-seen",
  authenticate,
  travTrackTier("on"),
  route(async (req, res) => {
    const seen = await lastSeen(req.userId!);
    res.json({
      lastSeen: seen && {
        at: new Date(seen.atMs).toISOString(),
        lat: seen.lat,
        lon: seen.lon,
        accuracyM: seen.accuracyM,
        deviceId: seen.deviceId,
        deviceLabel: seen.deviceLabel,
        origin: seen.origin,
      },
    });
  })
);

/**
 * DELETE /travtrack/points?from&to (instants) or ?fromDay&toDay (days, both
 * inclusive, on the profile's clock) — every point of the span, and the span
 * is remembered. Always 200: nothing is owed anywhere else.
 */
router.delete(
  "/travtrack/points",
  authenticate,
  travTrackTier("held"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    const userId = req.userId!;
    const { from, to } = await resolveSpan(userId, travTrackRangeQuerySchema.parse(req.query));
    const { deleted, gapsClipped } = await deleteTravTrackRange(userId, from, to);
    logger.info({ operation: "travtrack.points.delete", deleted, gapsClipped });
    res.json({ deleted });
  })
);

export default router;
