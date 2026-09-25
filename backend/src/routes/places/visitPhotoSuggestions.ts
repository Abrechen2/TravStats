import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { immichProxyLimiter, statsLimiter } from "../../middleware/rateLimit";
import { assetIdParamSchema, assetSizeSchema } from "../../schemas/immich";
import { sendPlaceholder, streamAsset } from "../../services/immich/assetStream";
import { createImmichClient } from "../../services/immich/immichClient";
import { getImmichConnection } from "../../services/immich/immichResolver";
import { ImmichError } from "../../services/immich/types";
import { linkPicksSchema } from "../../schemas/place";
import {
  isSuggestedLibraryAsset,
  linkPickedPhotos,
  visitPhotoSuggestionsFor,
} from "../../services/places/visitPhotoSuggestions";
import logger from "../../utils/logger";

/**
 * Photographs a visit could show — "Fotos aus deiner Reise" (package 9, item 2).
 *
 * Own file on the places prefix, mounted before `places.ts` like its siblings.
 * The listing and the link share the stats bucket: each is one bounded query
 * plus, at most, one Immich day search that the asset cache then holds for a
 * minute. The thumbnail proxy shares the other proxies' bucket, because a
 * suggestion strip loads a couple of dozen tiles at once.
 *
 * ## A library id is only ever served after the server found it itself
 *
 * The thumbnail route takes an asset id from the URL, as the album proxy does,
 * and answers 404 unless that id is among the visit's suggestions — a search
 * the server ran against the caller's own connection for the visit's day and
 * the place's surroundings. Owning a visit therefore does not make this a
 * reader for the library, only for the photographs that could be linked to it.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

export const visitParamsSchema = z.object({ visitId: z.string().uuid() });

router.get(
  "/visits/:visitId/photo-suggestions",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = visitParamsSchema.safeParse(req.params);
      if (!params.success) throw new AppError("Invalid visit id", 400);
      const result = await visitPhotoSuggestionsFor(req.userId!, params.data.visitId);
      if (result === null) throw new AppError("Visit not found", 404);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/visits/:visitId/photo-suggestions/link",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = visitParamsSchema.safeParse(req.params);
      if (!params.success) throw new AppError("Invalid visit id", 400);
      const body = linkPicksSchema.safeParse(req.body ?? {});
      if (!body.success) throw new AppError(body.error.message, 400);
      const picks = {
        tripPhotoIds: [...new Set(body.data.tripPhotoIds)],
        assetIds: [...new Set(body.data.assetIds)],
      };
      const result = await linkPickedPhotos(req.userId!, params.data.visitId, picks);
      if (result === null) throw new AppError("Visit not found", 404);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/visits/:visitId/photo-suggestions/library/:assetId/file",
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = visitParamsSchema.safeParse(req.params);
      if (!params.success) throw new AppError("Invalid visit id", 400);
      const assetId = assetIdParamSchema.safeParse(req.params.assetId);
      if (!assetId.success) throw new AppError("Invalid asset id", 400);
      const size = assetSizeSchema.safeParse(req.query.size ?? "thumbnail");
      if (!size.success) throw new AppError("Invalid size", 400);

      const suggested = await isSuggestedLibraryAsset(
        req.userId!,
        params.data.visitId,
        assetId.data
      );
      // One answer for "not your visit" and "not a suggestion": both are 404,
      // in the failure-kind vocabulary the Immich proxies share.
      if (!suggested) throw new AppError("notFound", 404);

      const etag = `"${assetId.data}-${size.data}"`;
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }
      const conn = await getImmichConnection(req.userId!);
      if (!conn) {
        res.status(409).json({ error: "notConfigured" });
        return;
      }
      await streamAsset(res, createImmichClient(conn), assetId.data, size.data, etag);
    } catch (error) {
      if (error instanceof ImmichError) {
        logger.warn({ message: "immich_proxy_upstream_failure", context: { kind: error.kind } });
        sendPlaceholder(res, error.kind === "notFound" ? 404 : 502);
        return;
      }
      next(error);
    }
  }
);

export default router;
