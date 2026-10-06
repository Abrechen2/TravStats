import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { flightDeviceDataLimiter } from "../../middleware/rateLimit";
import {
  FLIGHT_TRACK_MAX_BODY_BYTES,
  flightTrackUploadSchema,
  type FlightTrackUpload,
} from "../../schemas/flightDevice";
import { flightTrackColumns } from "../../services/flightDevice/flightTrackIngest";
import { overlapsSchedule, scheduledInstants } from "../../services/flightDevice/flightWindow";
import { trackTimes, type TrackZoneColumns } from "../../services/flightDevice/trackTimes";
import logger from "../../utils/logger";

/**
 * The phone's recording of a flight (forgejo#193) — `GET`/`POST`/`DELETE
 * /api/v1/flights/:id/track`. Mounted after the main flights router, at the
 * same prefix (the `cruises/tracks.ts` pattern): `routes/flights.ts` sits on
 * its frozen size.
 *
 * Bare responses, like every flights router (ADR 0001). The Companion
 * authenticates with its paired-device token (a write-scoped PAT), the web app
 * with its session cookie; `authenticate` takes either.
 */

const router = Router();
router.use("/:id/track", authenticate, requireWriteScope, flightDeviceDataLimiter);

/** What a write answer carries — never the line itself. */
const TRACK_META_SELECT = {
  id: true,
  flightId: true,
  source: true,
  uploadId: true,
  deviceId: true,
  startedAt: true,
  endedAt: true,
  pointCount: true,
  distanceKm: true,
  createdAt: true,
  updatedAt: true,
} as const;

type TrackMeta = Prisma.FlightTrackGetPayload<{ select: typeof TRACK_META_SELECT }>;

/** Owner check. Another user's flight answers exactly like a missing one. */
async function loadOwnedFlight(flightId: string, userId: string) {
  const flight = await prisma.flight.findFirst({
    where: { id: flightId, userId },
    select: {
      id: true,
      departureTime: true,
      arrivalTime: true,
      depTimeSemantics: true,
      arrTimeSemantics: true,
      depTimezone: true,
      arrTimezone: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
    },
  });
  if (!flight) throw new AppError("Flight not found", 404, "FLIGHT_NOT_FOUND");
  return flight;
}

type OwnedFlight = Awaited<ReturnType<typeof loadOwnedFlight>>;

/**
 * The stored row as a client reads it: start and end as `TimeValue`s under
 * `times` (ADR 0002 D3) instead of bare instants a client would have to guess
 * a zone for.
 */
async function present<T extends { startedAt: Date; endedAt: Date }>(
  track: T,
  flight: TrackZoneColumns
) {
  const { startedAt, endedAt, ...rest } = track;
  return { ...rest, times: await trackTimes({ startedAt, endedAt }, flight) };
}

const alreadyRecorded = () =>
  new AppError("This flight already has a recording", 409, "TRACK_ALREADY_RECORDED");

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Writes the recording (create, or replace when asked). Answers `replayed`
 * when a concurrent delivery of the SAME upload won the race — the loser
 * reads what the winner stored instead of failing an idempotent retry.
 */
async function writeTrack(
  flight: OwnedFlight,
  body: FlightTrackUpload,
  existing: TrackMeta | null,
  deviceId: string | null
): Promise<{ track: TrackMeta; replayed: boolean }> {
  const columns = flightTrackColumns(body.points);
  if (!columns) {
    throw new AppError("Too few distinct points to draw a line", 400, "VALIDATION_FAILED");
  }
  const data = { ...columns, source: "companion", uploadId: body.uploadId, deviceId };
  try {
    const track = existing
      ? await prisma.flightTrack.update({
          where: { flightId: flight.id },
          data,
          select: TRACK_META_SELECT,
        })
      : await prisma.flightTrack.create({
          data: { ...data, flightId: flight.id },
          select: TRACK_META_SELECT,
        });
    return { track, replayed: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await prisma.flightTrack.findUnique({
      where: { flightId: flight.id },
      select: TRACK_META_SELECT,
    });
    if (!winner || winner.uploadId !== body.uploadId) throw alreadyRecorded();
    return { track: winner, replayed: true };
  }
}

/**
 * GET /flights/:id/track — the recording with its line, or `{ track: null }`
 * when the phone sent none. "No recording" is an answer, not an error.
 */
router.get("/:id/track", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const flight = await loadOwnedFlight(req.params.id, req.userId!);
    const track = await prisma.flightTrack.findUnique({
      where: { flightId: flight.id },
      select: { ...TRACK_META_SELECT, geometry: true, segmentStarts: true, elevations: true },
    });
    res.json({ track: track ? await present(track, flight) : null });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /flights/:id/track — JSON `{ uploadId, replace?, points: [{t, lat, lon,
 * alt?, speed?}] }`.
 *
 *   - same `uploadId` as the stored recording → 200 with it, `replayed: true`
 *     (an outbox retry; nothing is written)
 *   - another `uploadId` while one is stored → 409 TRACK_ALREADY_RECORDED,
 *     unless `replace: true` — a shorter second recording must never silently
 *     displace a complete first one
 *   - otherwise → 201, stored
 */
router.post(
  "/:id/track",
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (Number(req.get("content-length") ?? 0) > FLIGHT_TRACK_MAX_BODY_BYTES) {
        throw new AppError("The recording is too large", 413, "TRACK_BODY_TOO_LARGE");
      }
      const flight = await loadOwnedFlight(req.params.id, req.userId!);
      const body = flightTrackUploadSchema.parse(req.body);

      const existing = await prisma.flightTrack.findUnique({
        where: { flightId: flight.id },
        select: TRACK_META_SELECT,
      });
      if (existing?.uploadId === body.uploadId) {
        res.json({ track: await present(existing, flight), replayed: true });
        return;
      }
      if (existing && !body.replace) throw alreadyRecorded();

      const first = body.points[0].t;
      const last = body.points[body.points.length - 1].t;
      if (!overlapsSchedule(first, last, await scheduledInstants(flight))) {
        throw new AppError(
          "The recording does not overlap this flight's schedule",
          422,
          "TRACK_OUTSIDE_FLIGHT"
        );
      }

      const { track, replayed } = await writeTrack(
        flight,
        body,
        existing,
        req.apiToken?.deviceId ?? null
      );
      logger.info({
        operation: existing ? "flight.track.replace" : "flight.track.create",
        flightId: flight.id,
        trackId: track.id,
        pointCount: track.pointCount,
        replayed,
      });
      res.status(replayed ? 200 : 201).json({ track: await present(track, flight), replayed });
    } catch (err) {
      next(err);
    }
  }
);

/** DELETE /flights/:id/track — `{ deleted: 1 }`, or `0` when there was none. */
router.delete("/:id/track", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const flight = await loadOwnedFlight(req.params.id, req.userId!);
    const { count } = await prisma.flightTrack.deleteMany({ where: { flightId: flight.id } });
    logger.info({ operation: "flight.track.delete", flightId: flight.id, deleted: count });
    res.json({ deleted: count });
  } catch (err) {
    next(err);
  }
});

export default router;
