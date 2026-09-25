import { Router, Response, NextFunction } from "express";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { railStationSearchLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { railStationSearchSchema } from "../../schemas/rail";
import { searchStations } from "../../services/rail/railStations";

/**
 * The rail station catalogue typeahead (spec 2026-09-25-rail-domain). A
 * global, read-only catalogue — Trainline stations.csv, ODbL — so there is
 * nothing to own and nothing to write. Outside the catalogue (thin beyond
 * Europe) the form falls back to the geocoder search the app already has.
 *
 * Mounted at /api/v1/rail/stations, ahead of the rail router, whose `/:id`
 * would otherwise take "stations" for a journey id.
 */
const router = Router();
router.use(authenticate);

router.get(
  "/",
  railStationSearchLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = railStationSearchSchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const data = await searchStations(parsed.data.q, parsed.data.limit);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
