import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { flightLivePositionLimiter } from "../../middleware/livePositionLimiter";
import { liveFlightPosition } from "../../services/flightLookup/livePosition";
import { FLIGHT_WINDOW_SELECT } from "../../services/tripRecording/bounds";

/**
 * `GET /api/v1/flights/:id/live-position` (forgejo#408 phase 2) — where the
 * aircraft is right now, for the Companion's cockpit and the web flight page.
 * Read-only; the session cookie or any PAT may call it. An unavailable
 * position is a 200 with a stable `reason`, so a poller needs no error path
 * for "not in the air".
 */
const router = Router();

router.get(
  "/:id/live-position",
  authenticate,
  flightLivePositionLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId!;
      const flight = await prisma.flight.findFirst({
        where: { id: req.params.id, userId },
        select: {
          ...FLIGHT_WINDOW_SELECT,
          status: true,
          flightNumber: true,
          aircraftModeS: true,
          aircraftRegistration: true,
        },
      });
      if (!flight) throw new AppError("Flight not found", 404, "FLIGHT_NOT_FOUND");
      res.json(await liveFlightPosition(flight, userId));
    } catch (err) {
      next(err);
    }
  }
);

export default router;
