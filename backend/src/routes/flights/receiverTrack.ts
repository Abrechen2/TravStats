import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { flightDeviceDataLimiter } from "../../middleware/rateLimit";
import { flightTrackColumns } from "../../services/flightDevice/flightTrackIngest";
import { recorderWindow, scheduledInstants } from "../../services/flightDevice/flightWindow";
import { FLIGHT_WINDOW_SELECT } from "../../services/tripRecording/bounds";
import {
  fetchReceiverTrack,
  resolveReceiver,
  type ReceiverReason,
} from "../../services/tar1090/receiverFetch";
import logger from "../../utils/logger";

/**
 * `POST /api/v1/flights/:id/track/receiver` — fetch a past flight's line from
 * the account's OWN tar1090 / readsb receiver (forgejo#408 phase 3) and store
 * it in the flight's one recording row (`source = "readsb"`), through the same
 * pipeline an upload goes through.
 *
 * A recording the passenger made or uploaded is never replaced unless
 * `replace: true`; the server's own lines (`aeroapi`, `readsb`) may be.
 * Every way it can fail answers with its own `RECEIVER_*` code.
 */

const router = Router();
router.use("/:id/track/receiver", authenticate, requireWriteScope, flightDeviceDataLimiter);

const bodySchema = z.object({ replace: z.boolean().optional() }).strict();
const HEX = /^[0-9a-f]{6}$/i;
const SERVER_SOURCES = new Set(["aeroapi", "readsb"]);

const REASON_ERRORS: Record<ReceiverReason, { status: number; code: string; message: string }> = {
  off: { status: 409, code: "RECEIVER_OFF", message: "The own-receiver service is switched off" },
  not_configured: {
    status: 409,
    code: "RECEIVER_NOT_CONFIGURED",
    message: "No own receiver address is set",
  },
  private_target: {
    status: 400,
    code: "PRIVATE_TARGET",
    message: "This account may not reach a receiver on a private address",
  },
  not_found: {
    status: 404,
    code: "RECEIVER_NOT_FOUND",
    message: "The receiver holds no trace of this aircraft for that day",
  },
  outside_window: {
    status: 422,
    code: "RECEIVER_OUTSIDE_WINDOW",
    message: "The receiver's trace does not cover this flight",
  },
  auth: { status: 502, code: "RECEIVER_AUTH", message: "The receiver refused the request" },
  timeout: {
    status: 504,
    code: "RECEIVER_TIMEOUT",
    message: "The receiver did not answer in time",
  },
  unreachable: {
    status: 502,
    code: "RECEIVER_UNREACHABLE",
    message: "The receiver could not be reached",
  },
  provider_error: {
    status: 502,
    code: "RECEIVER_ERROR",
    message: "The receiver answered with an error",
  },
  bad_trace: {
    status: 502,
    code: "RECEIVER_BAD_TRACE",
    message: "The receiver's answer is not a tar1090 trace file",
  },
};

export function receiverError(reason: ReceiverReason): AppError {
  const { status, code, message } = REASON_ERRORS[reason];
  return new AppError(message, status, code as never);
}

router.post(
  "/:id/track/receiver",
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const { replace } = bodySchema.parse(req.body ?? {});
      const flight = await prisma.flight.findFirst({
        where: { id: req.params.id, userId },
        select: { id: true, aircraftModeS: true, ...FLIGHT_WINDOW_SELECT },
      });
      if (!flight) throw new AppError("Flight not found", 404, "FLIGHT_NOT_FOUND");

      const hex = flight.aircraftModeS?.trim() ?? "";
      if (!HEX.test(hex)) {
        throw new AppError(
          "The flight has no ICAO24 (Mode S) hex to look the aircraft up by",
          422,
          "RECEIVER_NO_AIRCRAFT"
        );
      }
      const window = recorderWindow(await scheduledInstants(flight));
      if (!window) {
        throw new AppError(
          "The flight has no schedule to find its trace by",
          422,
          "RECEIVER_NO_SCHEDULE"
        );
      }

      const existing = await prisma.flightTrack.findUnique({
        where: { flightId: flight.id },
        select: { source: true },
      });
      if (existing && !replace && !SERVER_SOURCES.has(existing.source)) {
        throw new AppError("This flight already has a recording", 409, "TRACK_ALREADY_RECORDED");
      }

      const resolved = await resolveReceiver(userId);
      if (!resolved.ok) throw receiverError(resolved.reason);

      const result = await fetchReceiverTrack(resolved.receiver, hex, window[0], window[1]);
      if (!result.ok) {
        logger.warn(
          { flightId: flight.id, reason: result.reason },
          "own-receiver track fetch failed"
        );
        throw receiverError(result.reason);
      }
      const columns = flightTrackColumns(result.points);
      if (!columns) throw receiverError("outside_window");

      const data = {
        ...columns,
        source: "readsb",
        uploadId: `readsb:${hex.toLowerCase()}`,
        deviceId: null,
      };
      const select = { id: true, flightId: true, source: true, pointCount: true, distanceKm: true };
      let track;
      if (existing) {
        // Conditional on the row STILL being a server line (unless asked to
        // replace): a recording that landed since the check above is not ours to overwrite.
        const { count } = await prisma.flightTrack.updateMany({
          where: replace
            ? { flightId: flight.id }
            : { flightId: flight.id, source: { in: [...SERVER_SOURCES] } },
          data,
        });
        if (count === 0) {
          throw new AppError("This flight already has a recording", 409, "TRACK_ALREADY_RECORDED");
        }
        track = await prisma.flightTrack.findUniqueOrThrow({
          where: { flightId: flight.id },
          select,
        });
      } else {
        track = await prisma.flightTrack.create({
          data: { ...data, flightId: flight.id },
          select,
        });
      }
      res.status(existing ? 200 : 201).json({ track, registration: result.registration });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        next(new AppError("This flight already has a recording", 409, "TRACK_ALREADY_RECORDED"));
        return;
      }
      next(err);
    }
  }
);

export default router;
