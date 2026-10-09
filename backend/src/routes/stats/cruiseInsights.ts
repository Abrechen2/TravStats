/**
 * GET /api/v1/stats/cruise-insights?year= — special events per voyage, new
 * ports and ports seen again, time in port, shore excursions, sea-day patterns
 * and identical itineraries (forgejo#257). The rules are in
 * `services/stats/cruiseInsights/`.
 *
 * Its own base ahead of the stats router, like `./flightInsights.ts`, because
 * `routes/stats.ts` may not grow; it brings `authenticate` and `statsEtag`
 * itself. Bare response, like the rest of `/stats`.
 */

import { Router, Response, NextFunction } from "express";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { statsEtag } from "../../middleware/statsEtag";
import { WrappedQuerySchema } from "../../schemas/statsQuery";
import { buildCruiseInsights } from "../../services/stats/cruiseInsights/build";
import { loadCruiseInsightContext } from "../../services/stats/cruiseInsights/load";

const router = Router();
router.use(authenticate);
router.use(statsEtag);

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = WrappedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
      return;
    }
    const ctx = await loadCruiseInsightContext(req.userId!);
    res.json(buildCruiseInsights(ctx, parsed.data.year ?? null));
  } catch (error) {
    next(error);
  }
});

export default router;
