import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { flightDeviceDataLimiter } from "../../middleware/rateLimit";
import {
  FLIGHT_TRACK_MAX_BODY_BYTES,
  flightTrackFileFieldsSchema,
  flightTrackUploadSchema,
  type FlightTrackSource,
} from "../../schemas/flightDevice";
import {
  flightTrackColumns,
  flightTrackColumnsFromParsed,
  type FlightTrackColumns,
} from "../../services/flightDevice/flightTrackIngest";
import {
  fileUploadId,
  placeUntimedTrack,
  readFlightTrackFile,
  refusalError,
  withoutEmptyElevations,
} from "../../services/flightDevice/flightTrackFile";
import { handleGpxUpload } from "../trips/tourTracks";
import { overlapsSchedule, scheduledInstants } from "../../services/flightDevice/flightWindow";
import { FLIGHT_WINDOW_SELECT } from "../../services/tripRecording/bounds";
import { trackTimes, type TrackZoneColumns } from "../../services/flightDevice/trackTimes";
import { flightLiveTrackingEnabled } from "../../services/settings/accountPrefs";
import logger from "../../utils/logger";
import { providerFlightTrack, trackSourceQuerySchema } from "./trackSource";
import { viewableFlightTrack, type ViewableTrack } from "../../services/travtrack/flightTrackView";

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
  jitterDropped: true,
  distanceKm: true,
  createdAt: true,
  updatedAt: true,
} as const;

type TrackMeta = Prisma.FlightTrackGetPayload<{ select: typeof TRACK_META_SELECT }>;

/** Owner check. Another user's flight answers exactly like a missing one. */
async function loadOwnedFlight(flightId: string, userId: string) {
  const flight = await prisma.flight.findFirst({
    where: { id: flightId, userId },
    // The window columns: a provider track is read in the precision-aware recorder window.
    select: { id: true, ...FLIGHT_WINDOW_SELECT },
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

/**
 * A privacy-cut line as a client reads it: an end the cut removed has no time
 * (the line holds no per-vertex times), and the running distance it was
 * measured with stays on the server, as it always has.
 */
async function presentCut<T extends { startedAt: Date; endedAt: Date; cumulativeKm?: unknown }>(
  viewable: ViewableTrack<T>,
  flight: TrackZoneColumns
) {
  const { cumulativeKm: _cumulativeKm, ...track } = viewable.track;
  const shown = await present(track, flight);
  return {
    ...shown,
    times: {
      startedAt: viewable.startCut ? null : shown.times.startedAt,
      endedAt: viewable.endCut ? null : shown.times.endedAt,
    },
  };
}

const alreadyRecorded = () =>
  new AppError("This flight already has a recording", 409, "TRACK_ALREADY_RECORDED");

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

interface TrackOrigin {
  source: FlightTrackSource;
  uploadId: string;
  deviceId: string | null;
}

/**
 * Writes the recording (create, or replace when asked). Answers `replayed`
 * when a concurrent delivery of the SAME upload won the race — the loser
 * reads what the winner stored instead of failing an idempotent retry.
 */
async function writeTrack(
  flight: OwnedFlight,
  columns: FlightTrackColumns,
  origin: TrackOrigin,
  existing: TrackMeta | null
): Promise<{ track: TrackMeta; replayed: boolean }> {
  const data = { ...columns, ...origin };
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
    if (!winner || winner.uploadId !== origin.uploadId) throw alreadyRecorded();
    return { track: winner, replayed: true };
  }
}

/**
 * GET /flights/:id/track — the recording with its line, or `{ track: null }`
 * when the phone sent none. "No recording" is an answer, not an error.
 */
router.get("/:id/track", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const flight = await loadOwnedFlight(req.params.id, userId);
    const { source } = trackSourceQuerySchema.parse(req.query);
    // Where the line comes from (TravTrack plan T5): the own recording by
    // default, else the chosen provider; `?source=` shows another explicitly.
    const { entry, track: fromProvider } = await providerFlightTrack(userId, flight, source);
    const meta = {
      origin: entry.origin,
      coverage: entry.coverage,
      alternatives: entry.alternatives,
      unchecked: entry.unchecked,
    };
    if (entry.origin !== "travstats") {
      res.json({ track: fromProvider ? await presentCut(fromProvider, flight) : null, ...meta });
      return;
    }
    const stored = await prisma.flightTrack.findUnique({
      where: { flightId: flight.id },
      select: {
        ...TRACK_META_SELECT,
        geometry: true,
        segmentStarts: true,
        elevations: true,
        cumulativeKm: true,
      },
    });
    const track = stored ? await viewableFlightTrack(userId, stored) : null;
    res.json({ track: track ? await presentCut(track, flight) : null, ...meta });
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
 *   - the account's live tracking off → 409 FLIGHT_TRACKING_DISABLED, nothing stored
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
      // "Live-Verfolgung" off (forgejo#321): the phone's recording is not taken.
      // A file the user uploads below is their own import and stays allowed.
      if (!(await flightLiveTrackingEnabled(req.userId!))) {
        throw new AppError(
          "Live tracking is switched off for this account",
          409,
          "FLIGHT_TRACKING_DISABLED"
        );
      }
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

      const columns = flightTrackColumns(body.points);
      if (!columns) {
        throw new AppError("Too few distinct points to draw a line", 400, "VALIDATION_FAILED");
      }
      const { track, replayed } = await writeTrack(
        flight,
        columns,
        { source: "companion", uploadId: body.uploadId, deviceId: req.apiToken?.deviceId ?? null },
        existing
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

/**
 * POST /flights/:id/track/file — multipart, one recording under `file`
 * (forgejo#312): GPX, KML, KMZ, TCX, FIT or Flightradar24's CSV, up to 15 MB,
 * told apart by its bytes. A file that gives no track is refused with its own
 * code (`refusalError`).
 * Optional field `replace=true`. Stored in the same one-per-flight row the
 * Companion writes, under the same rules:
 *
 *   - the same bytes again → 200 with the stored row, `replayed: true`
 *   - another recording stored → 409 TRACK_ALREADY_RECORDED unless replace
 *   - a span nowhere near the schedule → 422 TRACK_OUTSIDE_FLIGHT
 *
 * A file without times is placed in the flight's schedule; with no schedule
 * either, it is refused (400 TRACK_NO_TIMESTAMPS). Only the parsed line is
 * kept — the file itself is never written to disk (see `handleGpxUpload`).
 * `rejectDemo` sits above the upload, as on every track upload.
 */
router.post(
  "/:id/track/file",
  rejectDemo,
  handleGpxUpload,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const flight = await loadOwnedFlight(req.params.id, req.userId!);
      if (!req.file) throw new AppError("No track file uploaded", 400, "TRACK_FILE_MISSING");
      const fields = flightTrackFileFieldsSchema.safeParse(req.body ?? {});
      if (!fields.success) throw new AppError(fields.error.message, 400, "VALIDATION_FAILED");

      const file = await readFlightTrackFile(req.file.buffer, req.file.originalname);
      if (!file.ok) throw refusalError(file.reason);

      const uploadId = fileUploadId(req.file.buffer);
      const existing = await prisma.flightTrack.findUnique({
        where: { flightId: flight.id },
        select: TRACK_META_SELECT,
      });
      if (existing?.uploadId === uploadId) {
        res.json({ track: await present(existing, flight), replayed: true });
        return;
      }
      if (existing && !fields.data.replace) throw alreadyRecorded();

      const scheduled = await scheduledInstants(flight);
      const placed = placeUntimedTrack(withoutEmptyElevations(file.track), scheduled, {
        departure: flight.depTimeSemantics,
        arrival: flight.arrTimeSemantics,
      });
      if (!placed) {
        throw new AppError(
          "This recording has no times and the flight has no departure or arrival time to place it in",
          400,
          "TRACK_NO_TIMESTAMPS"
        );
      }
      if (!overlapsSchedule(placed.startedAt.getTime(), placed.endedAt.getTime(), scheduled)) {
        throw new AppError(
          "The recording does not overlap this flight's schedule",
          422,
          "TRACK_OUTSIDE_FLIGHT"
        );
      }
      const columns = flightTrackColumnsFromParsed(placed);
      if (!columns) {
        throw new AppError(
          "The file has fewer than two usable positions",
          400,
          "TRACK_FILE_UNREADABLE"
        );
      }

      const { track, replayed } = await writeTrack(
        flight,
        columns,
        { source: file.format, uploadId, deviceId: null },
        existing
      );
      logger.info({
        operation: existing ? "flight.track.file.replace" : "flight.track.file.create",
        flightId: flight.id,
        trackId: track.id,
        format: file.format,
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
