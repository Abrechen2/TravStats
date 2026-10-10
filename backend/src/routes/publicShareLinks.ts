import { Router, type NextFunction, type Request, type Response } from "express";

import { AppError } from "../middleware/errorHandler";
import logger from "../utils/logger";
import { shareLinkPhotoLimiter, shareLinkViewLimiter } from "../middleware/shareLinkRateLimit";
import { shareLinkPhotoSchema, shareLinkResolveSchema } from "../schemas/shareLinks";
import {
  notFound,
  resolvePublicPhoto,
  resolvePublicView,
} from "../services/shareLinks/linkService";

/**
 * `/api/v1/public/share-links` — what a stranger holding a share link may
 * ask (forgejo#281). No authentication, by design: the token IS the
 * permission, and it travels in the POST body, never in a URL, so no access
 * log, proxy or Referer ever holds it (design §2, T1).
 *
 * Every failure is the same 404 `SHARE_LINK_NOT_FOUND` — a malformed body
 * included — so the endpoint cannot be asked whether a token ever existed.
 * Enveloped (`{success, data}`, ADR 0001); the photo answers bytes.
 */
const router = Router();

/** No cache anywhere, no index, no Referer — on every answer, the 404s too. */
router.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      // A fault of ours (the database, a view that failed its strict schema)
      // is logged in full and answered like a missing link: the stranger at
      // the other end learns nothing, the operator learns everything.
      logger.error({
        operation: "public_share_link_failed",
        error: { message: err instanceof Error ? err.message : String(err) },
      });
      next(notFound());
    }
  };

router.post(
  "/view",
  shareLinkViewLimiter,
  handle(async (req, res) => {
    const parsed = shareLinkResolveSchema.safeParse(req.body ?? {});
    const resolved = parsed.success ? await resolvePublicView(parsed.data.token) : null;
    if (!resolved) throw notFound();
    res.json({ success: true, data: resolved });
  })
);

router.post(
  "/photo",
  shareLinkPhotoLimiter,
  handle(async (req, res) => {
    const parsed = shareLinkPhotoSchema.safeParse(req.body ?? {});
    const photo = parsed.success
      ? await resolvePublicPhoto(parsed.data.token, parsed.data.index)
      : null;
    if (!photo) throw notFound();
    res.type(photo.type);
    res.send(photo.bytes);
  })
);

export default router;
