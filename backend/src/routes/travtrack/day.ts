import { Router, type NextFunction, type Response } from "express";

import { authenticate, type AuthRequest } from "../../middleware/auth";
import { travTrackDayQuerySchema } from "../../schemas/travtrack";
import { travTrackDay } from "../../services/travtrack/dayView";
import { travTrackTier } from "./gate";

/**
 * `GET /travtrack/day?date=YYYY-MM-DD` (TravTrack plan T6): one day of the
 * history on the profile clock — `services/travtrack/dayView.ts`, labelled
 * from TravStats by `dayContext.ts` (plan E10). Tier `on`:
 * a view, so it answers only while the instance shows TravTrack. Bare (ADR
 * 0001), private to the owner.
 */

const router = Router();

router.get(
  "/travtrack/day",
  authenticate,
  travTrackTier("on"),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { date } = travTrackDayQuerySchema.parse(req.query);
      res.json(await travTrackDay(req.userId!, date));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
