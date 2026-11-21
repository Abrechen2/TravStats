import { Router, type NextFunction, type Response } from "express";
import { type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { ferryCreationLimiter } from "../../middleware/ferryCreationLimiter";
import { routeFerryJourney } from "../../services/ferry/ferryRouting";
import { requestedBaseVersion } from "../../services/sync/versionPrecondition";
import { clearFerryManualRoute, setFerryManualRoute } from "../../services/ferry/ferryManualRoute";

/** Mounted behind the ferry router's authentication and write-scope guards. */
const router = Router();
router.post(
  "/:id/route",
  ferryCreationLimiter,
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await routeFerryJourney(req.userId!, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
);

/** A hand-drawn line for the crossing (forgejo#431). */
router.put(
  "/:id/route-override",
  ferryCreationLimiter,
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const ride = await setFerryManualRoute(
        req.userId!,
        req.params.id,
        req.body,
        requestedBaseVersion(req)
      );
      res.json({ success: true, data: ride });
    } catch (error) {
      next(error);
    }
  }
);
router.delete(
  "/:id/route-override",
  ferryCreationLimiter,
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { outcome, ride } = await clearFerryManualRoute(
        req.userId!,
        req.params.id,
        requestedBaseVersion(req)
      );
      res.json({ success: true, data: ride, meta: { seaRoute: outcome } });
    } catch (error) {
      next(error);
    }
  }
);
export default router;
