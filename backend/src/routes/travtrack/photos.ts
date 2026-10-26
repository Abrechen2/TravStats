import { Router, type NextFunction, type Response } from "express";

import { authenticate, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { immichProxyLimiter } from "../../middleware/rateLimit";
import { travTrackPhotoSearchLimiter } from "../../middleware/travTrackViewLimits";
import {
  TRAVTRACK_PHOTO_MAX_DAYS,
  travTrackPhotoAssetIdSchema,
  travTrackPhotoFileQuerySchema,
  travTrackPhotosQuerySchema,
} from "../../schemas/travtrackViews";
import { sendPlaceholder, streamAsset } from "../../services/immich/assetStream";
import { createImmichClient } from "../../services/immich/immichClient";
import { getImmichConnection } from "../../services/immich/immichResolver";
import { ImmichError } from "../../services/immich/types";
import {
  PHOTO_WINDOW_MAX_MS,
  PhotosNotConfigured,
  photoInWindow,
  travTrackPhotos,
} from "../../services/travtrack/photos";
import logger from "../../utils/logger";
import { travTrackTier } from "./gate";

/**
 * Photos during a time window, placed on the account's safe track (TravTrack
 * plan T5.3, `services/travtrack/photos.ts`), and their thumbnails. Tier `on`.
 * Bare (ADR 0001); a failure answers in the Immich vocabulary the web's
 * `immichFailureKind()` reads: 409 `{ error: "notConfigured" }`, 502
 * `{ error: <kind> }` for `unreachable | auth | notFound | protocol | invalidUrl`.
 *
 * The thumbnail route's grant is the list: it streams an asset only while
 * the same window's list holds it — a photo inside a privacy zone, in a cut
 * or anywhere the track does not place it is 404, so owning a window cannot
 * be turned into reading the library. Renditions only (no original: its
 * bytes carry the EXIF position).
 */

const router = Router();

const windowOf = (q: { from: string; to: string }) => {
  const window = { fromMs: Date.parse(q.from), untilMs: Date.parse(q.to) };
  if (window.untilMs - window.fromMs > PHOTO_WINDOW_MAX_MS) {
    throw new AppError(
      `A photo window covers at most ${TRAVTRACK_PHOTO_MAX_DAYS} days`,
      400,
      "TRAVTRACK_PHOTO_WINDOW_TOO_LONG"
    );
  }
  return window;
};

router.get(
  "/travtrack/photos",
  authenticate,
  travTrackTier("on"),
  travTrackPhotoSearchLimiter,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const window = windowOf(travTrackPhotosQuerySchema.parse(req.query));
        res.json(await travTrackPhotos(req.userId!, window));
      } catch (error) {
        if (error instanceof PhotosNotConfigured) {
          res
            .status(409)
            .json({ error: "notConfigured", message: "No Immich connection configured" });
          return;
        }
        if (error instanceof ImmichError) {
          logger.warn({
            message: "travtrack_photos_upstream_failure",
            context: { kind: error.kind },
          });
          res.status(502).json({ error: error.kind, message: error.message });
          return;
        }
        next(error);
      }
    })();
  }
);

router.get(
  "/travtrack/photos/:assetId/file",
  authenticate,
  travTrackTier("on"),
  immichProxyLimiter,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const userId = req.userId!;
        const assetId = travTrackPhotoAssetIdSchema.safeParse(req.params.assetId);
        if (!assetId.success) throw new AppError("notFound", 404);
        const q = travTrackPhotoFileQuerySchema.parse(req.query);
        const window = windowOf(q);
        if (!(await photoInWindow(userId, window, assetId.data))) {
          throw new AppError("notFound", 404);
        }
        const etag = `"${assetId.data}-${q.size}"`;
        if (req.headers["if-none-match"] === etag) {
          res.status(304).end();
          return;
        }
        const conn = await getImmichConnection(userId);
        if (!conn) {
          res.status(409).json({ error: "notConfigured" });
          return;
        }
        await streamAsset(res, createImmichClient(conn), assetId.data, q.size, etag);
      } catch (error) {
        if (error instanceof PhotosNotConfigured) {
          res.status(409).json({ error: "notConfigured" });
          return;
        }
        if (error instanceof ImmichError) {
          logger.warn({ message: "immich_proxy_upstream_failure", context: { kind: error.kind } });
          sendPlaceholder(res, error.kind === "notFound" ? 404 : 502);
          return;
        }
        next(error);
      }
    })();
  }
);

export default router;
