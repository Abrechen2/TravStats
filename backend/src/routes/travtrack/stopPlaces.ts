import { Router, type NextFunction, type Response } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { travTrackStopPlaceLimiter } from "../../middleware/travTrackViewLimits";
import {
  travTrackStopDismissBodySchema,
  travTrackStopPlaceBodySchema,
  travTrackStopPlaceQuerySchema,
} from "../../schemas/travtrackStopPlaces";
import { setStopPlace } from "../../services/travtrack/stopPlaces/accept";
import { setStopDismissed } from "../../services/travtrack/stopPlaces/dismiss";
import { stopIdentityFor } from "../../services/travtrack/stopPlaces/identity";
import logger from "../../utils/logger";
import { travTrackTier } from "./gate";

/**
 * A stop's place (spec 2026-11-03-travtrack-legs, "As built — stop places"):
 * `GET /travtrack/stops/place` says what a stop probably was, `PUT` stores the
 * name the owner accepted. Tier `on`, like the day they belong to. Bare (ADR
 * 0001), private to the owner.
 */

const router = Router();
const invalid = (message?: string) =>
  new AppError(message ?? "Invalid stop", 400, "TRAVTRACK_STOP_INVALID");

router.get(
  "/travtrack/stops/place",
  authenticate,
  travTrackTier("on"),
  travTrackStopPlaceLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = travTrackStopPlaceQuerySchema.safeParse(req.query);
      if (!query.success) throw invalid(query.error.issues[0]?.message);
      res.json(await stopIdentityFor(req.userId!, query.data));
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  "/travtrack/stops/place",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  travTrackStopPlaceLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = travTrackStopPlaceBodySchema.safeParse(req.body);
      if (!body.success) throw invalid(body.error.issues[0]?.message);
      const { fromMs, untilMs, place } = body.data;
      const stop = await setStopPlace(req.userId!, { fromMs, untilMs }, place);
      logger.info({ operation: "travtrack.stop.place", accepted: place !== null });
      res.json(stop);
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  "/travtrack/stops/dismissed",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  travTrackStopPlaceLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = travTrackStopDismissBodySchema.safeParse(req.body);
      if (!body.success) throw invalid(body.error.issues[0]?.message);
      const { fromMs, untilMs, dismissed } = body.data;
      const stop = await setStopDismissed(req.userId!, { fromMs, untilMs }, dismissed);
      logger.info({ operation: "travtrack.stop.dismissed", dismissed });
      res.json(stop);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
