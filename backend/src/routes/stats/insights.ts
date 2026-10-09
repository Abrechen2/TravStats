/**
 * `GET /api/v1/stats/insights/*` — the statistics expansion (forgejo#258,
 * #259, #260, #264): readings of lodging, places, roadtrips and day tours that
 * the per-domain rollups do not carry.
 *
 * Mounted on its own base (`routes/mounts.ts`) because `routes/stats.ts` is on
 * the file-size debt list and may not grow; it brings the stats router's two
 * middlewares itself, like `stats/networkRoute.ts`. Bare responses, like the
 * rest of `/stats` (docs/adr/0001-api-response-shape.md).
 *
 * Every answer is LIFETIME with per-year series: coming back to a house over
 * years or a place after five years has no meaning inside one year, and the
 * page picks the year slice where a figure has one.
 */

import { Router, Response, NextFunction } from "express";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { statsEtag } from "../../middleware/statsEtag";
import { lodgingInsights } from "../../services/stats/insights";

const router = Router();
router.use(authenticate);
router.use(statsEtag);

router.get("/lodging", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json((await lodgingInsights(req.userId!)).response);
  } catch (error) {
    next(error);
  }
});

export default router;
