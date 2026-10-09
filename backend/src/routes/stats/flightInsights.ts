/**
 * GET /api/v1/stats/flight-insights?year= — discovery, returns, how the
 * network grew, transfer times and the year's story (forgejo#256). The rules
 * are in `services/stats/flightInsights/`.
 *
 * Mounted on its own base ahead of the stats router (`routes/mounts.ts`)
 * because `routes/stats.ts` is on the file-size debt list and may not grow —
 * the pattern `./networkRoute.ts` set. It brings the stats router's two
 * middlewares itself. Bare response, like the rest of `/stats`
 * (docs/adr/0001-api-response-shape.md).
 */

import { Router, Response, NextFunction } from "express";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { statsEtag } from "../../middleware/statsEtag";
import { WrappedQuerySchema } from "../../schemas/statsQuery";
import { buildFlightInsights } from "../../services/stats/flightInsights/build";
import { loadFlightInsightRows } from "../../services/stats/flightInsights/rows";

const router = Router();
router.use(authenticate);
router.use(statsEtag);

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // The same `?year=` the year in review reads: the story's year, nothing else.
    const parsed = WrappedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
      return;
    }
    const rows = await loadFlightInsightRows(req.userId!);
    res.json(await buildFlightInsights(rows, parsed.data.year ?? null));
  } catch (error) {
    next(error);
  }
});

export default router;
