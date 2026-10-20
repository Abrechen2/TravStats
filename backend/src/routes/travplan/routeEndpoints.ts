/** TravPlan v2 route-plan endpoints; bare response family like the parent router. */
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { findReceipt, ownedPlan, writePlan } from "../../services/travplan/store";
import { routeStage } from "../../services/travplan/stageRouting";
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

router.post(
  "/trips/:tripId/plan/stages/:stageId/route",
  authenticate,
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    const body = z
      .object({ clientRef: uuid, baseRevision: z.number().int().min(1) })
      .strict()
      .parse(req.body);
    const tripId = uuid.parse(req.params.tripId);
    const stageId = uuid.parse(req.params.stageId);
    // A retry after a lost response replays the first answer: routing again could
    // yield different figures (and spend a provider call) for the same clientRef.
    const replayed = await findReceipt(req.userId!, tripId, body.clientRef);
    if (replayed) {
      res.json(replayed);
      return;
    }
    const plan = await ownedPlan(req.userId!, tripId);
    // Routed outside the write transaction: a provider call must not hold it open.
    const metrics = await routeStage(req.userId!, parseState(plan.state), stageId);
    res.json(
      await writePlan(req.userId!, tripId, {
        ...body,
        operation: { type: "stage_metrics", stageId, ...metrics },
      })
    );
  })
);

export default router;
