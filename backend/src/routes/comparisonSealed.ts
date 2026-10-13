/** Mounted AFTER comparison cookie/beta/demo/rate guards. Never mount directly. */
import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth";
import { prisma } from "../db";
import { scopeSchema } from "../services/federation/contract";
import { prepareScope } from "../services/federation/permissions";
import { ownedLink } from "../services/federation/links";
import { refused } from "../services/federation/security";
import {
  ownDevices,
  registerDevice,
  revokeDevice,
  beginPublication,
  putChunk,
  finishPublication,
  ownSealed,
} from "../services/federation/e2e/store";
import { recipients, ask, groupRead } from "../services/federation/e2e/relay";
import { uuid, fingerprint, e2eRequest } from "../services/federation/e2e/wire";
import { collectComparison } from "../services/federation/e2e/source";
import { ownerAsset } from "../services/federation/e2e/assets";
const router = Router();
const handle =
  (fn: (req: AuthRequest, res: Response) => Promise<void>) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
router.get(
  "/devices",
  handle(async (req, res) => {
    res.json({ success: true, data: await ownDevices(req.userId!) });
  })
);
router.post(
  "/devices",
  handle(async (req, res) => {
    res.json({ success: true, data: await registerDevice(req.userId!, req.body) });
  })
);
router.delete(
  "/devices/:id",
  handle(async (req, res) => {
    res.json({ success: true, data: await revokeDevice(req.userId!, uuid.parse(req.params.id)) });
  })
);
const target = z.strictObject({ linkId: uuid.nullable(), circleId: uuid.optional() });
router.post(
  "/recipients",
  handle(async (req, res) => {
    const b = target.parse(req.body);
    res.json({ success: true, data: await recipients(req.userId!, b.linkId, b.circleId) });
  })
);
router.post(
  "/source",
  handle(async (req, res) => {
    const b = scopeSchema.parse(req.body);
    res.json({
      success: true,
      data: await collectComparison(req.userId!, await prepareScope(req.userId!, b)),
    });
  })
);
router.get(
  "/asset/:kind/:id",
  handle(async (req, res) => {
    const asset = await ownerAsset(
      req.userId!,
      String(req.params.kind),
      uuid.parse(req.params.id),
      req.query.assetId ? uuid.parse(req.query.assetId) : undefined
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/octet-stream");
    if (asset.size !== null) res.setHeader("Content-Length", asset.size);
    asset.stream.on("error", () => res.destroy());
    res.on("close", () => asset.stream.destroy());
    asset.stream.pipe(res);
  })
);
router.post(
  "/begin",
  handle(async (req, res) => {
    const b = z.strictObject({ linkId: uuid, context: z.unknown() }).parse(req.body);
    res.json({ success: true, data: await beginPublication(req.userId!, b.linkId, b.context) });
  })
);
router.post(
  "/:id/chunk",
  handle(async (req, res) => {
    res.json({
      success: true,
      data: await putChunk(req.userId!, uuid.parse(req.params.id), req.body),
    });
  })
);
router.post(
  "/:id/finish",
  handle(async (req, res) => {
    res.json({
      success: true,
      data: await finishPublication(req.userId!, uuid.parse(req.params.id), req.body),
    });
  })
);
router.delete(
  "/:id",
  handle(async (req, res) => {
    await prisma.comparisonPublication.deleteMany({
      where: { id: uuid.parse(req.params.id), userId: req.userId! },
    });
    res.json({ success: true, data: { deleted: true } });
  })
);
router.post(
  "/read",
  handle(async (req, res) => {
    const b = target
      .extend({
        audience: z.string().max(100),
        source: z.union([uuid, z.literal("host")]).optional(),
        recipient: fingerprint,
        publication: uuid.optional(),
        part: z.number().int().min(0).max(8191).optional(),
        own: z.boolean().optional(),
      })
      .parse(req.body);
    // The authenticated viewer may request ciphertext only for one of their active devices.
    if (!(await ownDevices(req.userId!)).some((d) => d.fingerprint === b.recipient))
      throw refused();
    let data;
    if (b.own) data = await ownSealed(req.userId!, b.audience, b.recipient, b.publication, b.part);
    else if (b.circleId && !b.linkId)
      data = await groupRead(
        req.userId!,
        b.circleId,
        e2eRequest.parse({
          action: "sealed",
          operation: "group-read",
          channel: b.circleId,
          audience: b.audience,
          circleId: b.circleId,
          source: b.source,
          recipient: b.recipient,
          publication: b.publication,
          part: b.part,
        })
      );
    else {
      if (!b.linkId) throw refused();
      data = await ask(await ownedLink(req.userId!, b.linkId), {
        operation: b.circleId ? "group-read" : "read",
        audience: b.audience,
        circleId: b.circleId,
        source: b.source,
        recipient: b.recipient,
        publication: b.publication,
        part: b.part,
      });
    }
    res.json({ success: true, data });
  })
);
export default router;
