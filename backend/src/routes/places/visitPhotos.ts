import fs from "fs";
import path from "path";
import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import {
  uploadPlacePhotos,
  getPlacePhotoDir,
  deletePlacePhotoFile,
} from "../../middleware/upload";
import { uploadReceiptLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

/**
 * Photo proof for a place visit.
 *
 * Mounted on `/api/v1/places` ALONGSIDE `routes/places.ts`. No path here
 * collides with one there — `/visits/:visitId/photos` carries a segment more
 * than the `/visits/:visitId` handlers and two more than `/:id` — but this
 * router goes on first anyway, for the same reason `curated.ts` does: relying
 * on segment counts to keep two routers apart is a rule nobody can see.
 *
 * ## Ownership is read off the VISIT, never off the photo
 *
 * `PlaceVisit` carries `userId`, so every handler starts by loading the visit
 * scoped to the caller and 404s if it is not theirs. The photo id is then only
 * ever used together with that visit id. Looking a photo up by its own id first
 * and checking the owner afterwards is the same query written in the order that
 * leaks existence through timing and through the error you get back.
 *
 * ## Why a separate table from TripPhoto
 *
 * `PlaceVisitPhoto` mirrors `TripPhoto` rather than generalising it. A
 * polymorphic photo owner would reach into the Immich import job, the resync
 * ordering invariant and the asset proxy's ownership check — three places where
 * the ownership question is already answered a specific way. Two similar tables
 * are cheaper than one table three subsystems have to re-learn.
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
  immichAssetId: string | null;
  createdAt: string;
}

function toPhotoDto(photo: {
  id: string;
  placeVisitId: string;
  caption: string | null;
  sortIdx: number;
  mimetype: string;
  sizeBytes: number;
  immichAssetId: string | null;
  createdAt: Date;
}): PhotoDto {
  return {
    id: photo.id,
    url: `/api/v1/places/visits/${photo.placeVisitId}/photos/${photo.id}/file`,
    caption: photo.caption,
    sortIdx: photo.sortIdx,
    mimetype: photo.mimetype,
    sizeBytes: photo.sizeBytes,
    immichAssetId: photo.immichAssetId,
    createdAt: photo.createdAt.toISOString(),
  };
}

/** The visit, or a 404 — the single ownership gate every handler goes through. */
async function resolveVisit(visitId: string, userId: string): Promise<{ id: string }> {
  const visit = await prisma.placeVisit.findFirst({
    where: { id: visitId, userId },
    select: { id: true },
  });
  if (!visit) throw new AppError("Visit not found", 404);
  return visit;
}

router.get(
  "/visits/:visitId/photos",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveVisit(req.params.visitId, userId);
      const photos = await prisma.placeVisitPhoto.findMany({
        where: { placeVisitId: req.params.visitId },
        orderBy: [{ sortIdx: "asc" }, { createdAt: "asc" }],
      });
      res.json({ success: true, data: photos.map(toPhotoDto) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Only the upload is rate-limited, on the shared file-upload bucket: it is the
 * one route here that writes to the data volume, and it takes 20 files of
 * 15 MB in a single request. The reads and the metadata edits around it are
 * ordinary per-user CRUD and stay unlimited — a gallery page fetches every
 * photo it shows through `/file`, so throttling that would punish looking.
 *
 * The limiter sits ABOVE multer so a refused request never lands its bytes on
 * disk and never reaches the orphan-cleanup path below.
 */
router.post(
  "/visits/:visitId/photos",
  uploadReceiptLimiter,
  uploadPlacePhotos.array("photos", 20),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const uploaded: Express.Multer.File[] = (req.files as Express.Multer.File[] | undefined) ?? [];
    try {
      const userId = req.userId!;
      await resolveVisit(req.params.visitId, userId);
      if (uploaded.length === 0) throw new AppError("No photos uploaded", 400);

      const last = await prisma.placeVisitPhoto.findFirst({
        where: { placeVisitId: req.params.visitId },
        orderBy: { sortIdx: "desc" },
        select: { sortIdx: true },
      });
      let nextIdx = (last?.sortIdx ?? -1) + 1;

      const created = await prisma.$transaction(
        uploaded.map((file) =>
          prisma.placeVisitPhoto.create({
            data: {
              placeVisitId: req.params.visitId,
              filename: file.filename,
              mimetype: file.mimetype,
              sizeBytes: file.size,
              sortIdx: nextIdx++,
            },
          })
        )
      );

      logger.info(
        { operation: "place_photo_upload", userId, visitId: req.params.visitId, count: created.length },
        "Place visit photos uploaded"
      );
      res.status(201).json({ success: true, data: created.map(toPhotoDto) });
    } catch (error) {
      // Multer has already written the bytes by the time the handler runs, so a
      // rejected upload leaves files with no row pointing at them. Remove them
      // here or the directory grows by every failed attempt forever.
      for (const file of uploaded) {
        try {
          // Rebuilt from the trusted directory plus multer's own generated
          // basename, never `file.path` — same defence the trip photo route
          // uses, and what clears the path-injection taint.
          const safePath = path.join(getPlacePhotoDir(), path.basename(file.filename));
          if (fs.existsSync(safePath)) fs.unlinkSync(safePath);
        } catch {
          logger.warn({
            operation: "place_photo_upload_cleanup_error",
            message: "Failed to clean up an orphaned place photo file",
            context: { filename: file.filename },
          });
        }
      }
      next(error);
    }
  }
);

router.get(
  "/visits/:visitId/photos/:photoId/file",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveVisit(req.params.visitId, userId);
      const photo = await prisma.placeVisitPhoto.findFirst({
        where: { id: req.params.photoId, placeVisitId: req.params.visitId },
      });
      if (!photo) throw new AppError("Photo not found", 404);

      const filePath = path.join(getPlacePhotoDir(), path.basename(photo.filename));
      if (!fs.existsSync(filePath)) throw new AppError("File missing", 404);

      // `private`, deliberately overriding the global `no-store` on /api: these
      // bytes are one user's photo, and a shared cache must never be allowed to
      // hold them. See the cache-control note in CLAUDE.md.
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.type(photo.mimetype);
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/visits/:visitId/photos/:photoId",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveVisit(req.params.visitId, userId);
      const existing = await prisma.placeVisitPhoto.findFirst({
        where: { id: req.params.photoId, placeVisitId: req.params.visitId },
      });
      if (!existing) throw new AppError("Photo not found", 404);

      const parsed = updatePhotoSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const input = parsed.data;

      const photo = await prisma.placeVisitPhoto.update({
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
  "/visits/:visitId/photos/:photoId",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveVisit(req.params.visitId, userId);
      const photo = await prisma.placeVisitPhoto.findFirst({
        where: { id: req.params.photoId, placeVisitId: req.params.visitId },
      });
      if (!photo) throw new AppError("Photo not found", 404);

      // Row first, bytes second. The other order can delete the file and then
      // fail the row, which leaves a photo the UI still lists and can never
      // show — a broken thumbnail is worse than a byte we did not reclaim.
      await prisma.placeVisitPhoto.delete({ where: { id: photo.id } });
      deletePlacePhotoFile(photo.filename);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
