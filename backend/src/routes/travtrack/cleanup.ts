import { Router, type NextFunction, type Response } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { travTrackLegModeLimiter } from "../../middleware/travTrackViewLimits";
import { z } from "../../schemas/zod";
import { useConfirmationSchema } from "../../schemas/externalServices";
import { sendConfirmationRequired } from "../../services/externalServices/useConsent";
import { MapMatchError, type MatchFailure } from "../../services/travtrack/cleanup/mapMatch";
import {
  MATCH_MAX_SPAN_MS,
  MatchGateError,
  mapMatchingAvailability,
  matchStretch,
  type MatchGateFailure,
} from "../../services/travtrack/cleanup/matchRun";
import { deleteMatch, setSmoothing } from "../../services/travtrack/cleanup/store";
import { resolveSpan } from "../../services/travtrack/range";
import logger from "../../utils/logger";
import { travTrackTier } from "./gate";

/**
 * The optional cleanup of a sparse or noisy TravTrack day (rc46 extras C).
 * Raw points are never changed by anything here: smoothing is a drawing
 * choice, a road match a stored drawing aid whose DELETE is the undo. Bare
 * response family (ADR 0001), private to the owner, tier `on`.
 */

const router = Router();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const smoothingBody = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("global"), enabled: z.boolean() }).strict(),
  z.object({ scope: z.literal("day"), date: day, enabled: z.boolean() }).strict(),
]);
const matchBody = z
  .object({
    fromMs: z.number().int().nonnegative(),
    untilMs: z.number().int().positive(),
    confirmation: useConfirmationSchema.optional(),
  })
  .strict()
  .refine((b) => b.untilMs > b.fromMs, { message: "untilMs must be after fromMs" })
  .refine((b) => b.untilMs - b.fromMs <= MATCH_MAX_SPAN_MS, {
    message: "A stretch is at most one day",
  });

/** Setup refusals are 409, a router that did not answer 502/504, an unusable match 422. */
const STATUS: Record<MatchFailure | MatchGateFailure, number> = {
  serviceOff: 409,
  notConfigured: 409,
  internetOff: 409,
  privateTarget: 409,
  invalidUrl: 409,
  timeout: 504,
  unreachable: 502,
  badResponse: 502,
  tooLarge: 422,
  tooFewPoints: 422,
  lowConfidence: 422,
};

function matchError(error: unknown): unknown {
  if (!(error instanceof MapMatchError) && !(error instanceof MatchGateError)) return error;
  return new AppError(
    `Map matching failed: ${error.reason}`,
    STATUS[error.reason],
    "MAP_MATCH_FAILED",
    undefined,
    { reason: error.reason }
  );
}

router.get(
  "/travtrack/cleanup/availability",
  authenticate,
  travTrackTier("on"),
  async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ mapMatching: await mapMatchingAvailability() });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  "/travtrack/cleanup/smoothing",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  travTrackLegModeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = smoothingBody.parse(req.body);
      const span =
        body.scope === "day"
          ? await resolveSpan(req.userId!, { fromDay: body.date, toDay: body.date })
          : null;
      await setSmoothing(
        req.userId!,
        span ? { fromMs: span.from.getTime(), untilMs: span.to.getTime() } : null,
        body.enabled
      );
      res.json({ scope: body.scope, enabled: body.enabled });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/travtrack/cleanup/match",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  travTrackLegModeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { fromMs, untilMs, confirmation } = matchBody.parse(req.body);
      const outcome = await matchStretch(req.userId!, { fromMs, untilMs }, confirmation);
      if (outcome.kind === "confirm") return sendConfirmationRequired(res, outcome.disclosure);
      logger.info({ operation: "travtrack.cleanup.match", points: outcome.match.pointCount });
      res.status(201).json(outcome.match);
    } catch (error) {
      next(matchError(error));
    }
  }
);

router.delete(
  "/travtrack/cleanup/match/:id",
  authenticate,
  travTrackTier("held"),
  requireWriteScope,
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      if (!(await deleteMatch(req.userId!, id))) throw new AppError("Match not found", 404);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
