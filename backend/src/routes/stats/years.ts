/**
 * GET /api/v1/stats/years — distance per year and month across the travel domains, with
 * TravTrack's recorded kilometres beside it (the "Jahre" cards of the statistics page).
 *
 * Mounted on its own base ahead of the stats router (`routes/mounts.ts`), like
 * `cross-domain`, because `routes/stats.ts` is on the file-size debt list. Bare response
 * (docs/adr/0001-api-response-shape.md); `statsEtag` answers 304 while nothing moved.
 */

import { Router, Response, NextFunction } from "express";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { statsEtag } from "../../middleware/statsEtag";
import { loadYearStats } from "../../services/stats/yearStats/loadYearStats";

const router = Router();
router.use(authenticate);
router.use(statsEtag);

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await loadYearStats(req.userId!));
  } catch (error) {
    next(error);
  }
});

export default router;
