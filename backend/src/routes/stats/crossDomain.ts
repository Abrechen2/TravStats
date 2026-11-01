/**
 * GET /api/v1/stats/cross-domain — cheap cross-domain statistics (forgejo#399).
 * The rules are in `utils/stats/crossDomain/` and the loaders in
 * `services/stats/crossDomain/`.
 *
 * Mounted on its own base ahead of the stats router (`routes/mounts.ts`),
 * like `domain-records`, because `routes/stats.ts` is on the file-size debt
 * list. Bare response (docs/adr/0001-api-response-shape.md).
 */

import { Router, Response, NextFunction } from "express";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { statsEtag } from "../../middleware/statsEtag";
import { loadCrossDomainStats } from "../../services/stats/crossDomain/crossDomainStats";

const router = Router();
router.use(authenticate);
router.use(statsEtag);

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await loadCrossDomainStats(req.userId!));
  } catch (error) {
    next(error);
  }
});

export default router;
