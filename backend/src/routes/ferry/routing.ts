import { Router, type NextFunction, type Response } from "express";
import { type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { ferryCreationLimiter } from "../../middleware/ferryCreationLimiter";
import { routeFerryJourney } from "../../services/ferry/ferryRouting";

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
export default router;
