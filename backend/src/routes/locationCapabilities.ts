import { Router, type Response, type NextFunction } from "express";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { locationCapabilities } from "../services/locationProvider/capabilities";

/**
 * `GET /api/v1/location/capabilities` (TravTrack plan, task S4): what the
 * Companion should record for this account. Bare response family.
 *
 * Answers for every authenticated caller, read-only tokens included — like
 * `GET /travplan/capabilities`, it is how a client learns what to do, so it
 * must not be the thing that fails. A Companion that gets a 404 here is
 * talking to an older server and behaves exactly as before.
 */
const router = Router();

router.get(
  "/capabilities",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await locationCapabilities(req.userId!));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
