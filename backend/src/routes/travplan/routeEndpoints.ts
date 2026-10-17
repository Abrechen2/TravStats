/** TravPlan v2 route-plan endpoints; bare response family like the parent router. */
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate, type AuthRequest } from "../../middleware/auth";
import { ownedPlan } from "../../services/travplan/store";
import { bookingSchema } from "../../services/travplan/schema";
import { matchPlaceholders } from "../../services/travplan/placeholders";
import { parseState } from "../../services/travplan/upgrade";

const router = Router();
const uuid = z.string().uuid();
const route =
  (fn: (req: AuthRequest, res: Response) => Promise<void>) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

router.post(
  "/trips/:tripId/plan/placeholder-matches",
  authenticate,
  route(async (req, res) => {
    const body = z.object({ booking: bookingSchema }).strict().parse(req.body);
    const plan = await ownedPlan(req.userId!, uuid.parse(req.params.tripId));
    res.json({ matches: matchPlaceholders(body.booking, parseState(plan.state)) });
  })
);

export default router;
