import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { flightDeviceDataLimiter } from "../../middleware/rateLimit";
import {
  TRIP_RECORDING_MAX_BODY_BYTES,
  tripRecordingQuerySchema,
  tripRecordingUploadSchema,
  type TripRecordingUpload,
} from "../../schemas/tripRecording";
import { tripRecordingEnabled } from "../../services/settings/suggestionSwitches";
import {
  TRIP_RECORDING_TRIP_SELECT,
  classifyPoint,
  tripClockZone,
  tripRecordingBounds,
  type RecordingTrip,
} from "../../services/tripRecording/bounds";
import { recordingToGpx } from "../../services/tripRecording/gpx";
import {
  displaySegments,
  pointsByDevice,
  rawSegments,
  recordingDays,
  type StoredPoint,
} from "../../services/tripRecording/segments";
import { gpxFileName } from "../../services/tour/tracks/gpxArchive";
import { serializeTime } from "../../shared/time/wire";
import logger from "../../utils/logger";

/**
 * The Companion's trip recording (forgejo#316) — `POST`/`GET`/`DELETE
 * /api/v1/trips/:id/recording` and `GET …/recording/gpx`. The server is the
 * record: what the phone collected during a trip is stored here, shown on the
 * trip map, exported with the account and survives a lost phone.
 *
 * Private to its owner. Nothing here is copied into a shared trip, a
 * `.travstats` file, a public link, a comparison or a federation publication;
 * the trip sharing, exchange and share-link code select their rows explicitly
 * and none selects these.
 *
 * Bare responses, like every trip router (ADR 0001). The Companion
 * authenticates with its paired-device token (a write-scoped PAT), the web
 * app with its session cookie.
 */

const router = Router();
router.use("/trips/:id/recording", authenticate, requireWriteScope);

/** Owner check. Another user's trip answers exactly like a missing one. */
async function loadOwnedTrip(tripId: string, userId: string): Promise<RecordingTrip> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: TRIP_RECORDING_TRIP_SELECT,
  });
  if (!trip) throw await tripGone(tripId, userId);
  return trip;
}

/**
 * Why a trip id names no trip of this user. A trip merged away leaves a
 * forwarding address, so a phone still holding its id can follow it instead of
 * dropping the points: 404 `TRIP_MERGED` with `mergedIntoTripId`. Only the
 * owner learns it; anything else is the plain `TRIP_NOT_FOUND`.
 */
async function tripGone(tripId: string, userId: string): Promise<AppError> {
  const redirect = await prisma.mergedTripRedirect.findFirst({
    where: { sourceTripId: tripId, userId },
    select: { mergedIntoTripId: true },
  });
  return redirect
    ? new AppError("Trip was merged into another", 404, "TRIP_MERGED", undefined, {
        mergedIntoTripId: redirect.mergedIntoTripId,
      })
    : new AppError("Trip not found", 404, "TRIP_NOT_FOUND");
}

const BATCH_ANSWER_SELECT = {
  id: true,
  tripId: true,
  pointCount: true,
  skippedOutsideTrip: true,
  skippedInFlight: true,
} as const;

type BatchAnswerRow = Prisma.TripRecordingBatchGetPayload<{ select: typeof BATCH_ANSWER_SELECT }>;

const answerOf = (batch: BatchAnswerRow, replayed: boolean) => ({
  batchId: batch.id,
  accepted: batch.pointCount,
  outsideTrip: batch.skippedOutsideTrip,
  inFlight: batch.skippedInFlight,
  replayed,
});

/**
 * The body, parsed. A coordinate off the globe has its own code — the phone
 * must drop that point, not retry it — the rest is the usual VALIDATION_FAILED.
 */
function parseUpload(body: unknown): TripRecordingUpload {
  const parsed = tripRecordingUploadSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  const coordinate = parsed.error.issues.find(
    (i) => i.path[0] === "points" && (i.path[2] === "lat" || i.path[2] === "lon")
  );
  if (coordinate) {
    throw new AppError(
      "A point's coordinate is not on the globe",
      400,
      "RECORDING_INVALID_POINT",
      coordinate.path.map(String).join(".")
    );
  }
  throw parsed.error;
}

/** A stored batch under this uploadId: the retry's answer, or a refusal when it is another trip's. */
async function replayOf(userId: string, tripId: string, uploadId: string) {
  const stored = await prisma.tripRecordingBatch.findUnique({
    where: { userId_uploadId: { userId, uploadId } },
    select: BATCH_ANSWER_SELECT,
  });
  if (!stored) return null;
  if (stored.tripId !== tripId) {
    throw new AppError(
      "This uploadId is already stored under another trip",
      409,
      "RECORDING_UPLOAD_ID_REUSED"
    );
  }
  return stored;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const isForeignKeyViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";

/**
 * POST /trips/:id/recording — `{ uploadId, points: [{ t, lat, lon, accuracy? }] }`.
 *
 *   - the account switch off → 409 TRIP_RECORDING_DISABLED, nothing stored
 *   - the same uploadId again → 200 with what was stored, `replayed: true`
 *   - otherwise the points inside the trip's days and outside every flight's
 *     recorder window are stored (201); the others are counted, not stored.
 *     When none is left, nothing is stored and `batchId` is null (200).
 */
router.post(
  "/trips/:id/recording",
  rejectDemo,
  flightDeviceDataLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (Number(req.get("content-length") ?? 0) > TRIP_RECORDING_MAX_BODY_BYTES) {
        throw new AppError("The recording is too large", 413, "TRACK_BODY_TOO_LARGE");
      }
      const userId = req.userId!;
      const trip = await loadOwnedTrip(req.params.id, userId);
      if (!(await tripRecordingEnabled(userId))) {
        throw new AppError(
          "Trip recording is switched off for this account",
          409,
          "TRIP_RECORDING_DISABLED"
        );
      }
      const body = parseUpload(req.body);

      const stored = await replayOf(userId, trip.id, body.uploadId);
      if (stored) {
        res.json(answerOf(stored, true));
        return;
      }

      const bounds = await tripRecordingBounds(userId, trip);
      if (!bounds) {
        throw new AppError(
          "The trip has no first or last day to place the recording in",
          422,
          "TRIP_RECORDING_NO_SPAN"
        );
      }
      const counts = { accepted: 0, outsideTrip: 0, inFlight: 0 };
      const kept: StoredPoint[] = [];
      for (const p of body.points) {
        const verdict = classifyPoint(p.t, bounds);
        counts[verdict] += 1;
        if (verdict === "accepted") kept.push([p.t, p.lat, p.lon, p.accuracy ?? null]);
      }
      if (kept.length === 0) {
        res.json({ batchId: null, ...counts, replayed: false });
        return;
      }
      kept.sort((a, b) => a[0] - b[0]);

      let batch: BatchAnswerRow;
      try {
        batch = await prisma.tripRecordingBatch.create({
          data: {
            userId,
            tripId: trip.id,
            deviceId: req.apiToken?.deviceId ?? null,
            uploadId: body.uploadId,
            startedAt: new Date(kept[0][0]),
            endedAt: new Date(kept[kept.length - 1][0]),
            points: kept as unknown as Prisma.InputJsonValue,
            pointCount: kept.length,
            skippedOutsideTrip: counts.outsideTrip,
            skippedInFlight: counts.inFlight,
          },
          select: BATCH_ANSWER_SELECT,
        });
      } catch (error) {
        // The trip went while the points were on their way (merged or deleted;
        // a merge holds the trip's row, so the insert waits and then meets the
        // missing key): the trip is gone, which is what the phone is told.
        if (isForeignKeyViolation(error)) throw await tripGone(trip.id, userId);
        // A concurrent delivery of the same upload won the race: answer what it stored.
        if (!isUniqueViolation(error)) throw error;
        const winner = await replayOf(userId, trip.id, body.uploadId);
        if (!winner) throw error;
        res.json(answerOf(winner, true));
        return;
      }
      logger.info({
        operation: "trip.recording.create",
        tripId: trip.id,
        batchId: batch.id,
        ...counts,
      });
      res.status(201).json(answerOf(batch, false));
    } catch (err) {
      next(err);
    }
  }
);

async function loadDevices(userId: string, trip: RecordingTrip, day: string | undefined) {
  const [batches, zone] = await Promise.all([
    prisma.tripRecordingBatch.findMany({
      where: { tripId: trip.id, userId },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      select: { deviceId: true, points: true },
    }),
    tripClockZone(userId, trip),
  ]);
  return { batches, zone, devices: pointsByDevice(batches, zone, day) };
}

/**
 * GET /trips/:id/recording?day= — the summary and the line for the map, cut
 * at every gap. No recording is an answer (`pointCount: 0`, no segments).
 * `summary.days` lists every recorded day, whatever `day` filters to.
 */
router.get("/trips/:id/recording", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const trip = await loadOwnedTrip(req.params.id, userId);
    const { day } = tripRecordingQuerySchema.parse(req.query);
    const { batches, zone, devices } = await loadDevices(userId, trip, day);
    const all = pointsByDevice(batches, zone).flatMap((d) => d.points);
    const shown = devices.flatMap((d) => d.points).sort((a, b) => a[0] - b[0]);
    const first = shown[0];
    const last = shown[shown.length - 1];
    res.json({
      summary: {
        pointCount: shown.length,
        firstAt: first ? serializeTime(new Date(first[0]), zone) : null,
        lastAt: last ? serializeTime(new Date(last[0]), zone) : null,
        devices: [...new Set(batches.flatMap((b) => (b.deviceId ? [b.deviceId] : [])))].sort(),
        days: recordingDays(all, zone).map((date) => ({ date, zone, precision: "day" as const })),
      },
      segments: displaySegments(rawSegments(devices)),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /trips/:id/recording/gpx — every raw point, one `<trkseg>` per stretch. */
router.get(
  "/trips/:id/recording/gpx",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const trip = await loadOwnedTrip(req.params.id, userId);
      const { devices } = await loadDevices(userId, trip, undefined);
      const segments = rawSegments(devices);
      const first = segments[0]?.[0];
      res.setHeader("Content-Type", "application/gpx+xml; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${gpxFileName(trip.name, first ? new Date(first[0]) : new Date(0), "_aufzeichnung")}"`
      );
      res.send(recordingToGpx(trip.name, segments));
    } catch (err) {
      next(err);
    }
  }
);

/** DELETE /trips/:id/recording — every batch of the trip; 204 also when there was none. */
router.delete(
  "/trips/:id/recording",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const trip = await loadOwnedTrip(req.params.id, userId);
      const { count } = await prisma.tripRecordingBatch.deleteMany({
        where: { tripId: trip.id, userId },
      });
      logger.info({ operation: "trip.recording.delete", tripId: trip.id, deleted: count });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
