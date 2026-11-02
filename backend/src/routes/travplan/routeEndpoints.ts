/** TravPlan v2 route-plan endpoints; bare response family like the parent router. */
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { findReceipt, writePlan } from "../../services/travplan/store";
import { accessiblePlan } from "../../services/travplan/access";
import { routeStage } from "../../services/travplan/stageRouting";
import { bookingSchema } from "../../services/travplan/schema";
import { matchPlaceholders } from "../../services/travplan/placeholders";
import { parseState } from "../../services/travplan/upgrade";
import { searchPlaces } from "../../services/travplan/placeSearch";
import { deletePlan, previewPlanDelete } from "../../services/travplan/planDelete";

const router = Router();
const uuid = z.string().uuid();
const route =
  (fn: (req: AuthRequest, res: Response) => Promise<void>) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

router.get(
  "/travplan/places",
  authenticate,
  route(async (req, res) => {
    const q = z
      .object({
        q: z.string().trim().min(2).max(120),
        language: z.enum(["de", "en"]).default("de"),
        kind: z.enum(["any", "port"]).default("any"),
      })
      .parse(req.query);
    res.json(await searchPlaces(req.userId!, q.q, q.language, q.kind));
  })
);

router.get(
  "/trips/:tripId/plan/delete-preview",
  authenticate,
  route(async (req, res) => {
    res.json(await previewPlanDelete(req.userId!, uuid.parse(req.params.tripId)));
  })
);

router.delete(
  "/trips/:tripId/plan",
  authenticate,
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    await deletePlan(req.userId!, uuid.parse(req.params.tripId));
    res.json({ deleted: true });
  })
);

router.post(
  "/trips/:tripId/plan/placeholder-matches",
  authenticate,
  route(async (req, res) => {
    const body = z.object({ booking: bookingSchema }).strict().parse(req.body);
    const plan = await accessiblePlan(req.userId!, uuid.parse(req.params.tripId));
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
    const plan = await accessiblePlan(req.userId!, tripId);
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
