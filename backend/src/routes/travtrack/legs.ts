import { Router, type NextFunction, type Response } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { travTrackLegModeLimiter } from "../../middleware/travTrackViewLimits";
import { travTrackLegModeBodySchema } from "../../schemas/travtrackLegs";
import { setLegMode } from "../../services/travtrack/legs/setMode";
import logger from "../../utils/logger";
import { travTrackTier } from "./gate";

/**
 * `PUT /travtrack/legs/mode` (spec 2026-11-03-travtrack-legs): correct the
 * mode of a stretch of the day view, or reset it. Tier `on`, like the day it
 * corrects. Bare (ADR 0001): answers the recomputed leg itself.
 */

const router = Router();

router.put(
  "/travtrack/legs/mode",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  travTrackLegModeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = travTrackLegModeBodySchema.safeParse(req.body);
      if (!body.success) {
        throw new AppError(
          body.error.issues[0]?.message ?? "Invalid span or mode",
          400,
          "TRAVTRACK_LEG_INVALID"
        );
      }
      const { fromMs, untilMs, mode } = body.data;
      const leg = await setLegMode(req.userId!, { fromMs, untilMs }, mode);
      logger.info({ operation: "travtrack.leg.mode", mode });
      res.json(leg);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
