import fs from "fs";
import path from "path";
import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import {
  uploadLodgingPhotos,
  getLodgingPhotoDir,
  deleteLodgingPhotoFile,
} from "../../middleware/upload";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

/**
 * Photographs of a HOUSE.
 *
 * Asked for by a tester who wanted pictures on the hotel (Alex, 2026-08-29).
 * They hang off the LODGING rather than off a stay on purpose: a photo of the
 * building, the lobby or the view is a fact about the place and survives every
 * visit, while a stay-level photo would be re-uploaded on every return.
 *
 * ## Ownership is read off the LODGING, never off the photo
 *
 * Every handler starts by loading the lodging scoped to the caller and 404s if
 * it is not theirs; the photo id is then only ever used together with that
 * lodging id. Looking a photo up by its own id first and checking the owner
 * afterwards is the same query written in the order that leaks existence
 * through timing and through the error that comes back.
 *
 * ## Why a third photo table
 *
 * `LodgingPhoto` mirrors `PlaceVisitPhoto`, which mirrors `TripPhoto`, rather
 * than the three being generalised. The argument is written out in
 * `routes/places/visitPhotos.ts` and holds here unchanged: a polymorphic photo
 * owner would reach into the Immich import job, the resync ordering invariant
 * and the asset proxy's ownership check — three places that already answer the
 * ownership question a specific way.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const updatePhotoSchema = z.object({
  caption: z.string().max(500).nullable().optional(),
  sortIdx: z.number().int().min(0).max(10000).optional(),
});

interface PhotoDto {
  id: string;
  url: string;
  caption: string | null;
  sortIdx: number;
  mimetype: string;
  sizeBytes: number;
  createdAt: string;
}

function toPhotoDto(photo: {
  id: string;
  lodgingId: string;
  caption: string | null;
  sortIdx: number;
  mimetype: string;
  sizeBytes: number;
  createdAt: Date;
}): PhotoDto {
  return {
    id: photo.id,
    url: `/api/v1/lodging/${photo.lodgingId}/photos/${photo.id}/file`,
    caption: photo.caption,
    sortIdx: photo.sortIdx,
    mimetype: photo.mimetype,
    sizeBytes: photo.sizeBytes,
    createdAt: photo.createdAt.toISOString(),
  };
}

/** The lodging, or a 404 — the single ownership gate every handler goes through. */
async function resolveLodging(lodgingId: string, userId: string): Promise<{ id: string }> {
  const lodging = await prisma.lodging.findFirst({
    where: { id: lodgingId, userId },
    select: { id: true },
  });
  if (!lodging) throw new AppError("Lodging not found", 404);
  return lodging;
}

router.get(
  "/:lodgingId/photos",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveLodging(req.params.lodgingId, userId);
      const photos = await prisma.lodgingPhoto.findMany({
        where: { lodgingId: req.params.lodgingId },
        orderBy: [{ sortIdx: "asc" }, { createdAt: "asc" }],
      });
      res.json({ success: true, data: photos.map(toPhotoDto) });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/:lodgingId/photos",
  uploadLodgingPhotos.array("photos", 20),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const uploaded: Express.Multer.File[] = (req.files as Express.Multer.File[] | undefined) ?? [];
    try {
      const userId = req.userId!;
      await resolveLodging(req.params.lodgingId, userId);
      if (uploaded.length === 0) throw new AppError("No photos uploaded", 400);

      const last = await prisma.lodgingPhoto.findFirst({
        where: { lodgingId: req.params.lodgingId },
        orderBy: { sortIdx: "desc" },
        select: { sortIdx: true },
      });
      let nextIdx = (last?.sortIdx ?? -1) + 1;

      const created = await prisma.$transaction(
        uploaded.map((file) =>
          prisma.lodgingPhoto.create({
            data: {
              lodgingId: req.params.lodgingId,
              filename: file.filename,
              mimetype: file.mimetype,
              sizeBytes: file.size,
              sortIdx: nextIdx++,
            },
          })
        )
      );

      logger.info(
        {
          operation: "lodging_photo_upload",
          userId,
          lodgingId: req.params.lodgingId,
          count: created.length,
        },
        "Lodging photos uploaded"
      );
      res.status(201).json({ success: true, data: created.map(toPhotoDto) });
    } catch (error) {
      // Multer has written the bytes before the handler runs, so a rejected
      // upload leaves files with no row pointing at them. Remove them here or
      // the directory grows by every failed attempt, forever.
      for (const file of uploaded) {
        try {
          // Rebuilt from the trusted directory plus multer's own generated
          // basename, never `file.path` — the same defence the other two photo
          // routes use, and what clears the path-injection taint.
          const safePath = path.join(getLodgingPhotoDir(), path.basename(file.filename));
          if (fs.existsSync(safePath)) fs.unlinkSync(safePath);
        } catch {
          logger.warn({
            operation: "lodging_photo_upload_cleanup_error",
            message: "Failed to clean up an orphaned lodging photo file",
            context: { filename: file.filename },
          });
        }
      }
      next(error);
    }
  }
);

router.get(
  "/:lodgingId/photos/:photoId/file",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveLodging(req.params.lodgingId, userId);
      const photo = await prisma.lodgingPhoto.findFirst({
        where: { id: req.params.photoId, lodgingId: req.params.lodgingId },
      });
      if (!photo) throw new AppError("Photo not found", 404);

      const filePath = path.join(getLodgingPhotoDir(), path.basename(photo.filename));
      if (!fs.existsSync(filePath)) throw new AppError("File missing", 404);

      // `private`, deliberately overriding the global `no-store` on /api: these
      // bytes are one user's photo, and a shared cache must never hold them.
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.type(photo.mimetype);
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/:lodgingId/photos/:photoId",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveLodging(req.params.lodgingId, userId);
      const existing = await prisma.lodgingPhoto.findFirst({
        where: { id: req.params.photoId, lodgingId: req.params.lodgingId },
      });
      if (!existing) throw new AppError("Photo not found", 404);

      const parsed = updatePhotoSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const input = parsed.data;

      const photo = await prisma.lodgingPhoto.update({
        where: { id: existing.id },
        data: {
          ...(input.caption !== undefined && { caption: input.caption }),
          ...(input.sortIdx !== undefined && { sortIdx: input.sortIdx }),
        },
      });
      res.json({ success: true, data: toPhotoDto(photo) });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/:lodgingId/photos/:photoId",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveLodging(req.params.lodgingId, userId);
      const photo = await prisma.lodgingPhoto.findFirst({
        where: { id: req.params.photoId, lodgingId: req.params.lodgingId },
      });
      if (!photo) throw new AppError("Photo not found", 404);

      // Row first, bytes second. The other order can delete the file and then
      // fail the row, leaving a photo the UI still lists and can never show —
      // a broken thumbnail is worse than a byte not reclaimed.
      await prisma.lodgingPhoto.delete({ where: { id: photo.id } });
      deleteLodgingPhotoFile(photo.filename);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
