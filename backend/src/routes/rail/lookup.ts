import { Router, Response, NextFunction } from "express";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { railLookupLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { railLookupQuerySchema } from "../../schemas/rail";
import { lookupTrain, railProviderSwitches } from "../../services/rail/lookup";
import { TRANSITOUS_SOURCES_URL } from "../../services/rail/lookup/transitous";

/**
 * A train by number and day (spec 2026-09-25-rail-domain, phase 2):
 * Transitous, then db-rest, then the user types it. Read-only — nothing is
 * stored here; the form takes the answer over and saves it with the journey,
 * and only then is the traced line fetched and frozen.
 *
 * Every call reaches a third party run by volunteers, so it has its own tight
 * bucket and the admin can switch either provider off.
 */
const router = Router();
router.use(authenticate);

/** Which providers this instance may ask — the form hides the button when none. */
router.get("/providers", async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const switches = await railProviderSwitches();
    res.json({
      success: true,
      data: { ...switches, transitousSourcesUrl: TRANSITOUS_SOURCES_URL },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/", railLookupLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = railLookupQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const q = parsed.data;
    const answer = await lookupTrain({
      trainNumber: q.trainNumber,
      category: q.category ?? null,
      date: q.date,
      from: { lat: q.fromLat ?? 0, lon: q.fromLon ?? 0, stationId: q.fromStationId ?? null },
    });
    res.json({ success: true, data: answer });
  } catch (err) {
    next(err);
  }
});

export default router;
