/**
 * GET /api/v1/stats/domain-records — the travel records beyond flights
 * (forgejo#265). The rules are in `services/stats/domainRecords.ts`.
 *
 * Mounted on its own base ahead of the stats router (`routes/mounts.ts`)
 * because `routes/stats.ts` is on the file-size debt list and may not grow;
 * it brings that router's two middlewares itself. Bare response, like the
 * rest of `/stats` (docs/adr/0001-api-response-shape.md).
 */

import { Router, Response, NextFunction } from "express";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { statsEtag } from "../../middleware/statsEtag";
import { loadDomainRecords } from "../../services/stats/domainRecords";

const router = Router();
router.use(authenticate);
router.use(statsEtag);

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ records: await loadDomainRecords(req.userId!) });
  } catch (error) {
    next(error);
  }
});

export default router;
