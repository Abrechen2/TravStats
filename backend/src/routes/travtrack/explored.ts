import { Router, type NextFunction, type Response } from "express";

import { authenticate, type AuthRequest } from "../../middleware/auth";
import { travTrackExploredQuerySchema } from "../../schemas/travtrack";
import { exploredAnswer } from "../../services/travtrack/explored/privacy";
import { travTrackTier } from "./gate";

/**
 * `GET /travtrack/explored?bbox=w,s,e,n` (TravTrack plan L1): the explored
 * map — the account's zoom-14 cells in the box as `[x, y]`, privacy zones
 * drawn as explored ground (`services/travtrack/explored/privacy.ts`). Tier
 * `on`: a view. Bare (ADR 0001), the owner's own account only, `no-store` by
 * the `/api` default.
 */

const router = Router();

router.get(
  "/travtrack/explored",
  authenticate,
  travTrackTier("on"),
  (req: AuthRequest, res: Response, next: NextFunction) => {
    const { bbox } = travTrackExploredQuerySchema.parse(req.query);
    exploredAnswer(req.userId!, bbox)
      .then(({ cells }) => res.json({ cells: cells.map((c) => [c.x, c.y]) }))
      .catch(next);
  }
);

export default router;
