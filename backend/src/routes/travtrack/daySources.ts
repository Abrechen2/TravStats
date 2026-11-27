import { Router, type NextFunction, type Response } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { travTrackRangeQuerySchema } from "../../schemas/travtrack";
import {
  daySourceChoiceSchema,
  daySourceDateSchema,
  questionableDaysQuerySchema,
} from "../../schemas/travtrackDaySources";
import { profileZoneOf } from "../../shared/time/profileZone";
import {
  daySourceSummary,
  deleteRangePreview,
  questionableDays,
  setDaySourceChoice,
} from "../../services/travtrack/bestSource/choices";
import { resolveSpan } from "../../services/travtrack/range";
import logger from "../../utils/logger";
import { travTrackTier } from "./gate";

/**
 * Best source per day (`services/travtrack/bestSource/`): which source a day
 * is drawn from, the user's choice, the list of questionable days and the
 * preview of a range delete. Bare (ADR 0001), the owner's alone.
 */

const router = Router();

function route(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}

/** GET /travtrack/day-sources/questionable — "Tage mit fragwürdigen Spuren", newest first. */
router.get(
  "/travtrack/day-sources/questionable",
  authenticate,
  travTrackTier("on"),
  route(async (req, res) => {
    const { page } = questionableDaysQuerySchema.parse(req.query);
    res.json(await questionableDays(req.userId!, page ?? 0));
  })
);

/** GET /travtrack/day-sources/:date — the day's sources, scores and verdicts. */
router.get(
  "/travtrack/day-sources/:date",
  authenticate,
  travTrackTier("on"),
  route(async (req, res) => {
    res.json(await daySourceSummary(req.userId!, daySourceDateSchema.parse(req.params.date)));
  })
);

/** PUT /travtrack/day-sources/:date — choose a source or decide on outliers; re-derives that day only. */
router.put(
  "/travtrack/day-sources/:date",
  authenticate,
  travTrackTier("held"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    const date = daySourceDateSchema.parse(req.params.date);
    const choice = daySourceChoiceSchema.parse(req.body);
    const summary = await setDaySourceChoice(req.userId!, date, choice);
    logger.info({ operation: "travtrack.daySource.choice", date });
    res.json(summary);
  })
);

/** GET /travtrack/points/delete-preview — what a range delete would remove, per day and source. */
router.get(
  "/travtrack/points/delete-preview",
  authenticate,
  travTrackTier("held"),
  route(async (req, res) => {
    const userId = req.userId!;
    const { from, to } = await resolveSpan(userId, travTrackRangeQuerySchema.parse(req.query));
    const { zone } = await profileZoneOf(userId);
    res.json(await deleteRangePreview(userId, from, to, zone));
  })
);

export default router;
