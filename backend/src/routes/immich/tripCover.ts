/**
 * Set a trip's cover from the gallery lightbox.
 *
 * A live-linked asset's cover is the proxy URL — nothing is copied, so the
 * cover stays a reference. A local photo (manual upload or imported copy) uses
 * the existing file route. Both simply write `Trip.coverImageUrl`.
 *
 * `POST /trips/:id/photos/:photoId/cover` is not Immich-specific, but
 * `routes/trips.ts` is at the 800-line hard cap, so it lands here next to its
 * sibling rather than growing a file that is already too big.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { resolveTrip } from "../trips";
import { setCoverSchema } from "../../schemas/immich";
import { createImmichClient } from "../../services/immich/immichClient";
import { getImmichConnection } from "../../services/immich/immichResolver";
import { getCachedAlbumAssets } from "../../services/immich/immichAssetCache";
import { ImmichError } from "../../services/immich/types";
import logger from "../../utils/logger";

const router = Router();

export function immichCoverUrl(tripId: string, linkId: string, assetId: string): string {
  return `/api/v1/trips/${tripId}/immich/albums/${linkId}/assets/${assetId}/file?size=preview`;
}

router.post(
  "/trips/:id/immich/cover",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const { linkId, assetId } = setCoverSchema.parse(req.body);

      const link = await prisma.tripImmichAlbum.findFirst({
        where: { id: linkId, tripId },
        select: { id: true, immichAlbumId: true },
      });
      if (!link) throw new AppError("Linked album not found", 404);

      const conn = await getImmichConnection(userId);
      if (!conn) throw new AppError("No Immich connection configured", 409);

      // The asset must belong to this album — same boundary the proxy enforces.
      const assets = await getCachedAlbumAssets(userId, link.immichAlbumId, () =>
        createImmichClient(conn).listAlbumAssets(link.immichAlbumId),
      );
      if (!assets.some((a) => a.id === assetId)) {
        throw new AppError("Asset not found in this album", 404);
      }

      const coverImageUrl = immichCoverUrl(tripId, link.id, assetId);
      await prisma.trip.update({ where: { id: tripId }, data: { coverImageUrl } });

      logger.info({ message: "immich_cover_set", context: { tripId, linkId: link.id } });
      res.json({ coverImageUrl });
    } catch (error) {
      if (error instanceof ImmichError) {
        res.status(502).json({ error: error.kind, message: error.message });
        return;
      }
      next(error);
    }
  },
);

router.post(
  "/trips/:id/photos/:photoId/cover",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);

      const photo = await prisma.tripPhoto.findFirst({
        where: { id: req.params.photoId, tripId },
        select: { id: true },
      });
      if (!photo) throw new AppError("Photo not found", 404);

      const coverImageUrl = `/api/v1/trips/${tripId}/photos/${photo.id}/file`;
      await prisma.trip.update({ where: { id: tripId }, data: { coverImageUrl } });

      res.json({ coverImageUrl });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
