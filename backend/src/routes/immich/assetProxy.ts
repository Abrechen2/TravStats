/**
 * Stream a linked album's image from Immich to the browser. Nothing is written
 * to disk — link mode's whole promise is zero duplicate storage (spec §5).
 *
 * Security (spec §8):
 *  - the caller must own the trip (`resolveTrip`),
 *  - the asset must be a member of THAT linked album (checked against the
 *    cached asset list), otherwise owning any trip would turn the proxy into
 *    an arbitrary-asset reader,
 *  - the upstream URL is built from the stored, normalised base URL plus a
 *    UUID-validated asset id. No client-supplied URL is ever fetched.
 *
 * Caching: an Immich asset id addresses immutable bytes, so we hand the
 * browser a strong ETag and a long private max-age and answer repeat views
 * with 304 without ever touching Immich.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { immichProxyLimiter } from "../../middleware/rateLimit";
import { resolveTrip } from "../trips";
import { assetIdParamSchema, assetSizeSchema } from "../../schemas/immich";
import { createImmichClient } from "../../services/immich/immichClient";
import { getImmichConnection } from "../../services/immich/immichResolver";
import { getCachedAlbumAssets } from "../../services/immich/immichAssetCache";
import { ImmichError } from "../../services/immich/types";
import logger from "../../utils/logger";

const router = Router();

const CACHE_CONTROL = "private, max-age=86400, immutable";

/** 1x1 transparent PNG — painted instead of a broken-image icon on failure. */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function sendPlaceholder(res: Response, status: number): void {
  if (res.headersSent) return;
  res.status(status);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.send(PLACEHOLDER_PNG);
}

router.get(
  "/trips/:id/immich/albums/:linkId/assets/:assetId/file",
  authenticate,
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const assetId = assetIdParamSchema.safeParse(req.params.assetId);
      if (!assetId.success) throw new AppError("Invalid asset id", 400);

      const size = assetSizeSchema.safeParse(req.query.size);
      if (!size.success) throw new AppError("Invalid size", 400);

      const etag = `"${assetId.data}-${size.data}"`;
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }

      const link = await prisma.tripImmichAlbum.findFirst({
        where: { id: req.params.linkId, tripId },
        select: { immichAlbumId: true },
      });
      if (!link) throw new AppError("Linked album not found", 404);

      const conn = await getImmichConnection(userId);
      if (!conn) {
        res.status(409).json({ error: "notConfigured" });
        return;
      }

      const client = createImmichClient(conn);
      const assets = await getCachedAlbumAssets(userId, link.immichAlbumId, () =>
        client.listAlbumAssets(link.immichAlbumId),
      );
      if (!assets.some((a) => a.id === assetId.data)) {
        throw new AppError("Asset not found in this album", 404);
      }

      const upstream = await client.fetchAssetStream(assetId.data, size.data);

      res.setHeader("Content-Type", upstream.contentType);
      res.setHeader("Cache-Control", CACHE_CONTROL);
      res.setHeader("ETag", etag);
      if (upstream.contentLength !== null) {
        res.setHeader("Content-Length", String(upstream.contentLength));
      }

      // A mid-stream upstream abort must not leave the response hanging.
      upstream.stream.on("error", (error: unknown) => {
        logger.error({
          message: "immich_proxy_stream_error",
          error,
          context: { assetId: assetId.data },
        });
        res.destroy();
      });

      upstream.stream.pipe(res);
    } catch (error) {
      if (error instanceof ImmichError) {
        logger.warn({ message: "immich_proxy_upstream_failure", context: { kind: error.kind } });
        sendPlaceholder(res, error.kind === "notFound" ? 404 : 502);
        return;
      }
      next(error);
    }
  },
);

export default router;
