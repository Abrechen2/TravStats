import { Router, type NextFunction, type Response } from "express";

import { authenticate, type AuthRequest } from "../middleware/auth";
import { gapCalendarQuerySchema } from "../schemas/gapCalendar";
import { gapCalendarYear } from "../services/gapCalendar";

/**
 * The gap calendar: per day of one year, whether the logbook, TravTrack or a
 * privacy zone explains it (spec 2026-11-22-gap-calendar). Own account only,
 * bare (ADR 0001), `no-store` by the `/api` default. It carries no position
 * and no fix count: a privacy-zone day says only that it is hidden.
 */
const router = Router();

router.get(
  "/",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { year } = gapCalendarQuerySchema.parse(req.query);
      res.json(await gapCalendarYear(req.userId!, year));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
