import sealedRouter from "./encryptedShareSealed";
import { prepareScope } from "../services/federation/permissions";
import { previewRecords, recordDomain } from "../services/federation/records";
import {
  createCircle,
  listCircles,
  grantCircle,
  ownerGrant,
  leaveCircle,
  removeMember,
  addMember,
} from "../services/federation/circles";
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { getInstanceSettings } from "../services/instanceSettingsService";
import { prisma } from "../db";
import { grantInput, claimInput, id, label, scopeSchema } from "../services/federation/contract";
import {
  invite,
  claim,
  changeLink,
  saveGrant,
  revokeGrant,
  listLinks,
} from "../services/federation/links";
import { buildSnapshot } from "../services/federation/snapshots";
import { refused } from "../services/federation/security";

/**
 * The full-record, device-encrypted transfer (protocol v2, docs/FEDERATION_E2E.md), moved here
 * from /comparison on 2026-10-16 so the leaderboard no longer depends on it. Behind its own beta
 * key `encryptedShare` until the owner keeps or cuts it. Behaviour unchanged.
 */
const router = Router();
type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle = (fn: Handler) => (req: AuthRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};
router.use(authenticate, rejectDemo);
router.use((req: AuthRequest, _res, next) => {
  void getInstanceSettings()
    .then((s) => {
      if (req.apiToken || !s.betaFeaturesEnabled) throw refused();
      next();
    })
    .catch(next);
});
router.use(
  rateLimit({
    windowMs: 60_000,
    limit: 1200,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthRequest).userId ?? ipKeyGenerator(req.ip ?? "unknown"),
  })
);
router.use("/sealed", sealedRouter);
router.get(
  "/links",
  handle(async (req, res) => {
    res.json({ success: true, data: await listLinks(req.userId!) });
  })
);
router.post(
  "/invites",
  handle(async (req, res) => {
    res.json({ success: true, data: await invite(req.userId!) });
  })
);
router.post(
  "/claim",
  handle(async (req, res) => {
    res.json({ success: true, data: await claim(req.userId!, claimInput.parse(req.body)) });
  })
);
router.post(
  "/links/:id/confirm",
  handle(async (req, res) => {
    const b = z.strictObject({ label, code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    res.json({
      success: true,
      data: await changeLink(req.userId!, id.parse(req.params.id), "confirm", b.label, b.code),
    });
  })
);
router.delete(
  "/links/:id",
  handle(async (req, res) => {
    res.json({
      success: true,
      data: await changeLink(req.userId!, id.parse(req.params.id), "revoke"),
    });
  })
);
router.post(
  "/links/:id/grant",
  handle(async (req, res) => {
    const b = grantInput.parse(req.body);
    res.json({
      success: true,
      data: await saveGrant(req.userId!, id.parse(req.params.id), b.audience, b.scope),
    });
  })
);
router.post(
  "/links/:id/revoke",
  handle(async (req, res) => {
    const b = z.strictObject({ audience: z.string().max(100) }).parse(req.body);
    res.json({
      success: true,
      data: await revokeGrant(req.userId!, id.parse(req.params.id), b.audience),
    });
  })
);
// The plaintext friend and group reads were retired for sealed publications. 410 tells an old
// client the endpoint is gone for good, where 403 read like a permission it might yet obtain.
const retired = (_req: unknown, res: Response) => {
  res.status(410).json({ error: "COMPARISON_PLAINTEXT_READ_RETIRED" });
};
router.post("/links/:id/read", retired);
router.post("/circles/read", retired);
router.post(
  "/preview",
  handle(async (req, res) => {
    const scope = scopeSchema.parse(req.body);
    res.json({
      success: true,
      data: await buildSnapshot(req.userId!, await prepareScope(req.userId!, scope), scope.year),
    });
  })
);
router.get(
  "/trips",
  handle(async (req, res) => {
    res.json({
      success: true,
      data: await prisma.trip.findMany({
        where: { userId: req.userId! },
        select: { id: true, name: true },
        orderBy: { startDate: "desc" },
        take: 500,
      }),
    });
  })
);

router.get(
  "/circles",
  handle(async (req, res) => {
    res.json({ success: true, data: await listCircles(req.userId!) });
  })
);
router.post(
  "/circles",
  handle(async (req, res) => {
    const b = z.strictObject({ name: label, linkIds: z.array(id).min(1).max(19) }).parse(req.body);
    res.json({ success: true, data: await createCircle(req.userId!, b.name, b.linkIds) });
  })
);
const circleAction = z.strictObject({
  circleId: id,
  linkId: id.nullable(),
  version: z.number().int().positive(),
});
router.post(
  "/circles/grant",
  handle(async (req, res) => {
    const b = circleAction.extend({ scope: scopeSchema }).parse(req.body);
    res.json({
      success: true,
      data: b.linkId
        ? await grantCircle(req.userId!, b.linkId, b.circleId, b.version, b.scope)
        : await ownerGrant(req.userId!, b.circleId, b.version, b.scope),
    });
  })
);
router.post(
  "/circles/leave",
  handle(async (req, res) => {
    const b = circleAction.parse(req.body);
    if (!b.linkId) throw refused();
    res.json({
      success: true,
      data: await leaveCircle(req.userId!, b.linkId, b.circleId, b.version),
    });
  })
);
router.post(
  "/circles/remove",
  handle(async (req, res) => {
    const b = z.strictObject({ circleId: id, channel: id }).parse(req.body);
    res.json({ success: true, data: await removeMember(req.userId!, b.circleId, b.channel) });
  })
);
router.post(
  "/preview/records",
  handle(async (req, res) => {
    const b = z
      .strictObject({
        scope: scopeSchema,
        domain: recordDomain,
      })
      .parse(req.body);
    const scope = await prepareScope(req.userId!, b.scope);
    res.json({ success: true, data: await previewRecords(req.userId!, scope, b.domain) });
  })
);
router.post(
  "/circles/add",
  handle(async (req, res) => {
    const b = z.strictObject({ circleId: id, linkId: id }).parse(req.body);
    res.json({ success: true, data: await addMember(req.userId!, b.circleId, b.linkId) });
  })
);
export default router;
