/** TravPlan contract v1, bare response family (like trips). */
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import {
  authenticate,
  requireWriteScope,
  requireAdmin,
  type AuthRequest,
} from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { prisma } from "../db";
import { AppError } from "../middleware/errorHandler";
import {
  configuration,
  createPlan,
  listPlans,
  ownedPlan,
  readPlan,
  writePlan,
} from "../services/travplan/store";
import { writeSchema, proposalContentSchema } from "../services/travplan/schema";
import { parseState } from "../services/travplan/upgrade";
import { generateProposal } from "../services/travplan/ai";
import { findLocations } from "../services/travplan/locations";
import { refreshForecast } from "../services/travplan/weather";
import { packingSuggestions } from "../services/travplan/rules";
import { recheckAchievementsAfterWrite } from "../middleware/recheckAchievementsAfterWrite";
import { planningImportPolicy } from "./travplan/importPolicy";
const router = Router();
router.use(planningImportPolicy);
const uuid = z.string().uuid();
const writeGuard = [authenticate, requireWriteScope, rejectDemo];
function route(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}
const tripId = (req: AuthRequest) => uuid.parse(req.params.tripId);
router.get(
  "/travplan/capabilities",
  authenticate,
  route(async (_req, res) => {
    const config = await configuration();
    res.json({
      version: 1,
      enabled: config.enabled,
      offlineWrites: true,
      ai: true,
      forecast: true,
      notifications: false,
    });
  })
);
router.get(
  "/travplan/config",
  authenticate,
  requireAdmin,
  route(async (_req, res) => {
    res.json(await configuration());
  })
);
router.patch(
  "/travplan/config",
  ...writeGuard,
  requireAdmin,
  route(async (req, res) => {
    const data = z
      .object({
        enabled: z.boolean(),
        aiDailyLimit: z.number().int().min(0).max(100),
        weatherDailyLimit: z.number().int().min(0).max(200),
      })
      .strict()
      .parse(req.body);
    res.json(
      await prisma.travelPlanConfig.upsert({
        where: { id: "default" },
        create: { id: "default", ...data },
        update: data,
      })
    );
  })
);
router.get(
  "/travplan/plans",
  authenticate,
  route(async (req, res) => {
    res.json({ plans: await listPlans(req.userId!) });
  })
);
router.post(
  "/travplan/plans",
  ...writeGuard,
  route(async (req, res) => {
    res.status(201).json(await createPlan(req.userId!, req.body));
  })
);
router.get(
  "/trips/:tripId/plan",
  authenticate,
  route(async (req, res) => {
    const result = await readPlan(req.userId!, tripId(req));
    res.setHeader("ETag", '"' + result.revision + '"');
    res.json(result);
  })
);
router.post(
  "/trips/:tripId/plan/mutations",
  ...writeGuard,
  (req, res, next) => {
    if (["execution", "link_actual", "undo"].includes(req.body?.operation?.type))
      recheckAchievementsAfterWrite(req, res, next);
    else next();
  },
  route(async (req, res) => {
    res.json(await writePlan(req.userId!, tripId(req), writeSchema.parse(req.body)));
  })
);
router.get(
  "/trips/:tripId/plan/proposals",
  authenticate,
  route(async (req, res) => {
    const plan = await ownedPlan(req.userId!, tripId(req));
    const rows = await prisma.travelPlanProposal.findMany({
      where: { planId: plan.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.json({
      proposals: rows.map((p) => ({
        id: p.id,
        baseRevision: p.baseRevision,
        status: p.status,
        provider: p.provider,
        model: p.model,
        content: proposalContentSchema.parse(p.content),
        expiresAt: p.expiresAt.toISOString(),
      })),
    });
  })
);
router.post(
  "/trips/:tripId/plan/proposals",
  ...writeGuard,
  route(async (req, res) => {
    const body = z
      .object({ request: z.string().trim().min(1).max(1000) })
      .strict()
      .parse(req.body);
    res.status(201).json(await generateProposal(req.userId!, tripId(req), body.request));
  })
);
router.delete(
  "/trips/:tripId/plan/proposals/:proposalId",
  ...writeGuard,
  route(async (req, res) => {
    const plan = await ownedPlan(req.userId!, tripId(req));
    const changed = await prisma.travelPlanProposal.updateMany({
      where: { id: uuid.parse(req.params.proposalId), planId: plan.id, status: "pending" },
      data: { status: "rejected" },
    });
    if (!changed.count) throw new AppError("Proposal not found", 404, "PLAN_PROPOSAL_NOT_FOUND");
    res.json({ rejected: true });
  })
);
router.post(
  "/trips/:tripId/plan/forecast",
  ...writeGuard,
  route(async (req, res) => {
    const body = z
      .object({ clientRef: uuid, baseRevision: z.number().int().min(1) })
      .strict()
      .parse(req.body);
    res.json(await refreshForecast(req.userId!, tripId(req), body));
  })
);
router.get(
  "/trips/:tripId/plan/packing-suggestions",
  authenticate,
  route(async (req, res) => {
    const plan = await ownedPlan(req.userId!, tripId(req));
    res.json({ suggestions: packingSuggestions(parseState(plan.state)) });
  })
);
router.get(
  "/travplan/locations",
  authenticate,
  route(async (req, res) => {
    const q = z
      .object({
        q: z.string().trim().min(2).max(120),
        language: z.enum(["de", "en"]).default("de"),
      })
      .parse(req.query);
    res.json({ locations: await findLocations(req.userId!, q.q, q.language) });
  })
);
export default router;
