import sealedRouter from "./comparisonSealed";
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
import { createPublicKey } from "crypto";
import { authenticate, requireAdmin, type AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { getInstanceSettings } from "../services/instanceSettingsService";
import { prisma } from "../db";
import {
  grantInput,
  claimInput,
  id,
  label,
  origin,
  scopeSchema,
} from "../services/federation/contract";
import {
  invite,
  claim,
  changeLink,
  saveGrant,
  revokeGrant,
  listLinks,
} from "../services/federation/links";
import { buildSnapshot } from "../services/federation/snapshots";
import { exchange, identity, refused, hash } from "../services/federation/security";
import { saveBoard } from "../services/federation/groups";

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
  "/audit",
  handle(async (req, res) => {
    res.json({
      success: true,
      data: await prisma.comparisonAudit.findMany({
        where: { ownerId: req.userId! },
        select: { channel: true, audience: true, revision: true, operation: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    });
  })
);
router.get(
  "/boards",
  handle(async (req, res) => {
    res.json({
      success: true,
      data: await prisma.comparisonGroup.findMany({ where: { userId: req.userId! } }),
    });
  })
);
router.post(
  "/boards",
  handle(async (req, res) => {
    const b = z
      .strictObject({ id: id.optional(), name: label, channels: z.array(id).max(20) })
      .parse(req.body);
    res.json({ success: true, data: await saveBoard(req.userId!, b) });
  })
);
router.get(
  "/peers",
  requireAdmin,
  handle(async (_req, res) => {
    let local = null;
    try {
      const i = identity();
      local = { origin: i.origin, publicKey: i.publicKey, fingerprint: i.fingerprint };
    } catch {
      /* Explicitly unconfigured. */
    }
    res.json({ success: true, data: { local, peers: await prisma.comparisonPeer.findMany() } });
  })
);
router.post(
  "/peers",
  requireAdmin,
  handle(async (req, res) => {
    const b = z
      .strictObject({
        origin,
        publicKey: z.string().min(40).max(500),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        enabled: z.boolean(),
      })
      .parse(req.body);
    if (b.origin === "local" || b.origin === identity().origin) throw refused();
    const key = createPublicKey(b.publicKey);
    if (key.asymmetricKeyType !== "ed25519") throw refused();
    const pem = key.export({ type: "spki", format: "pem" }).toString();
    if (hash(pem) !== b.fingerprint) throw refused();
    const previous = await prisma.comparisonPeer.findUnique({ where: { origin: b.origin } });
    if (previous && previous.publicKey !== pem) {
      await prisma.comparisonLink.updateMany({
        where: { origin: b.origin },
        data: { revoked: true },
      });
    }
    res.json({
      success: true,
      data: await prisma.comparisonPeer.upsert({
        where: { origin: b.origin },
        create: { origin: b.origin, publicKey: pem, enabled: b.enabled },
        update: { publicKey: pem, enabled: b.enabled, verifiedAt: null },
      }),
    });
  })
);
router.post(
  "/peers/verify",
  requireAdmin,
  handle(async (req, res) => {
    const b = z.strictObject({ origin }).parse(req.body);
    const reply = await exchange(b.origin, { action: "ping" });
    if (!reply || typeof reply !== "object" || !("ready" in reply) || reply.ready !== true)
      throw refused();
    await prisma.comparisonPeer.update({
      where: { origin: b.origin },
      data: { verifiedAt: new Date() },
    });
    res.json({ success: true, data: { verified: true } });
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
  "/peers/suspend",
  requireAdmin,
  handle(async (req, res) => {
    const b = z.strictObject({ origin }).parse(req.body);
    await prisma.comparisonPeer.update({
      where: { origin: b.origin },
      data: { enabled: false, verifiedAt: null },
    });
    res.json({ success: true, data: { suspended: true } });
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
