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
import { z } from "zod";
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
import { sendPlaceholder, streamAsset } from "../../services/immich/assetStream";

const router = Router();

/**
 * A position in the stored preview strip.
 *
 * Bounded rather than open: the strip is capped when written, and an
 * unbounded integer here would let a caller probe the array's length one
 * request at a time.
 */
const previewIndexSchema = z.coerce.number().int().min(0).max(63);

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
      // `error` body uses the failure-kind vocabulary (`notFound`) so a caller
      // that reads it classifies a domain 404 correctly.
      if (!link) throw new AppError("notFound", 404);

      const conn = await getImmichConnection(userId);
      if (!conn) {
        res.status(409).json({ error: "notConfigured" });
        return;
      }

      const client = createImmichClient(conn);
      const assets = await getCachedAlbumAssets(userId, link.immichAlbumId, () =>
        client.listAlbumAssets(link.immichAlbumId)
      );
      if (!assets.some((a) => a.id === assetId.data)) {
        throw new AppError("notFound", 404);
      }

      await streamAsset(res, client, assetId.data, size.data, etag);
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

/**
 * Stream one photograph of a suggested journey's preview strip.
 *
 * A `PhotoJourney` row keeps `previewAssetIds` — "ids rather than images: the
 * proxy already streams thumbnails". It did not, for these: the album route
 * above serves only an asset that is a MEMBER of a linked album, and a journey
 * has no album. Every id stored on those rows was therefore unreachable, and
 * any client drawing the strip got a 404 (forgejo#94).
 *
 * **The row is the grant.** The caller owns the journey; the asset id comes
 * from the stored array at the requested INDEX and never from the request. A
 * client cannot name an id, so owning one journey cannot be turned into
 * reading the library — which is the same property the album route buys with
 * its membership check, obtained here without an album to check against.
 *
 * Everything after that decision is the album route's: same limiter, same
 * private immutable caching, same placeholder on an upstream failure.
 */
router.get(
  "/photo-journeys/:id/preview/:index/file",
  authenticate,
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;

      const index = previewIndexSchema.safeParse(req.params.index);
      if (!index.success) throw new AppError("Invalid preview index", 400);

      const size = assetSizeSchema.safeParse(req.query.size);
      if (!size.success) throw new AppError("Invalid size", 400);

      // Scoped by userId in the same query, not checked afterwards: a journey
      // that belongs to someone else must be indistinguishable from one that
      // does not exist.
      const journey = await prisma.photoJourney.findFirst({
        where: { id: req.params.id, userId },
        select: { previewAssetIds: true },
      });
      if (!journey) throw new AppError("notFound", 404);

      const assetId = journey.previewAssetIds[index.data];
      if (assetId === undefined) throw new AppError("notFound", 404);

      const etag = `"${assetId}-${size.data}"`;
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }

      const conn = await getImmichConnection(userId);
      if (!conn) {
        res.status(409).json({ error: "notConfigured" });
        return;
      }

      await streamAsset(res, createImmichClient(conn), assetId, size.data, etag);
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
