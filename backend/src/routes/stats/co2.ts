import { Router, Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth";
import { loadCo2Stats } from "../../services/co2/co2Stats";

/**
 * `GET /stats/co2` — carbon per mode of travel (forgejo#395), lifetime. A bare
 * response, like the rest of the stats router (docs/adr/0001-api-response-shape.md).
 * Split out of `routes/stats.ts`, which the size ratchet has frozen.
 */
const router = Router();

router.get("/co2", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await loadCo2Stats(req.userId!));
  } catch (error) {
    next(error);
  }
});

export default router;
