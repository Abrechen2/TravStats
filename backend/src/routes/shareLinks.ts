import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { shareLinkCreateLimiter } from "../middleware/shareLinkRateLimit";
import { shareLinkCreateSchema, shareLinkPreviewSchema } from "../schemas/shareLinks";
import { getPublicBaseUrl } from "../services/instanceSettingsService";
import {
  createShareLink,
  listShareLinks,
  previewShareLink,
  revokeShareLink,
  shareLinksEnabled,
} from "../services/shareLinks/linkService";

/**
 * `/api/v1/share-links` — the owner's side of public share links
 * (forgejo#281, design `docs/superpowers/specs/2026-10-10-share-links-design.md`):
 * list, preview, create, revoke. The public side is `publicShareLinks.ts`.
 *
 * Enveloped (`{success, data}`, ADR 0001). A target or link id of another
 * account answers exactly like one that does not exist. The shared demo
 * account (every visitor of a public instance at once) may read but not
 * create — a public link minted from it would be anyone's.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);
router.use(rejectDemoWrites);

type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle =
  (fn: Handler) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

router.get(
  "/",
  handle(async (req, res) => {
    const [enabled, links] = await Promise.all([shareLinksEnabled(), listShareLinks(req.userId!)]);
    res.json({ success: true, data: { enabled, links } });
  })
);

router.post(
  "/preview",
  handle(async (req, res) => {
    const selection = shareLinkPreviewSchema.parse(req.body ?? {});
    res.json({ success: true, data: await previewShareLink(req.userId!, selection) });
  })
);

router.post(
  "/",
  shareLinkCreateLimiter,
  handle(async (req, res) => {
    const { expiresAt, ...selection } = shareLinkCreateSchema.parse(req.body ?? {});
    const created = await createShareLink(
      req.userId!,
      selection,
      new Date(expiresAt),
      await getPublicBaseUrl(req)
    );
    res.status(201).json({ success: true, data: created });
  })
);

router.delete(
  "/:id",
  handle(async (req, res) => {
    const id = z.string().min(1).max(100).parse(req.params.id);
    await revokeShareLink(req.userId!, id);
    res.json({ success: true, data: { id } });
  })
);

export default router;
