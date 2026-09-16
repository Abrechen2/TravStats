import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

import { uploadReceiptLimiter } from "../../middleware/rateLimit";
import {
  uploadTripPhotos,
  uploadTripCover,
  deleteTripPhotoFile,
  getTripPhotoDir,
} from "../../middleware/upload";
import path from "path";
import fs from "fs";
import { resolveTrip } from "./resolveTrip";
import { toPhotoDto } from "./photoDto";

/**
 * Trip photos and the cover image — a same-prefix satellite of routes/trips.ts, split out when that
 * file sat at 1217 lines on the file-size debt list (forgejo#59). The routes
 * moved verbatim; mounts.ts registers this router right after `trips`, so
 * Express meets them in the same order as before.
 *
 * Middleware is PER ROUTE, as in trips.ts: every handler names its own
 * `authenticate` / `requireWriteScope`, and ownership goes through
 * `resolveTrip`.
 */

const router = Router();

/* ─────────── Photos (iter 7) ─────────── */

const updatePhotoSchema = z.object({
  caption: z.string().max(500).nullable().optional(),
  takenAt: z.string().datetime().nullable().optional(),
  sortIdx: z.number().int().min(0).max(10000).optional(),
});

/**
 * POST /trips/:id/photos — upload one or more images.
 *
 * Shares the file-upload bucket with every other route that writes user bytes
 * to the data volume; 20 files of 15 MB per request is the same disk-exhaustion
 * shape as the place-visit photo upload, and the two must not disagree about
 * it. The limiter sits above multer so a refused request writes nothing.
 */
router.post(
  "/trips/:id/photos",
  authenticate,
  requireWriteScope,
  uploadReceiptLimiter,
  uploadTripPhotos.array("photos", 20),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const uploaded: Express.Multer.File[] = (req.files as Express.Multer.File[] | undefined) ?? [];
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      if (uploaded.length === 0) throw new AppError("No photos uploaded", 400);

      const last = await prisma.tripPhoto.findFirst({
        where: { tripId: req.params.id },
        orderBy: { sortIdx: "desc" },
        select: { sortIdx: true },
      });
      let nextIdx = (last?.sortIdx ?? -1) + 1;

      const created = await prisma.$transaction(
        uploaded.map((f) =>
          prisma.tripPhoto.create({
            data: {
              tripId: req.params.id,
              filename: f.filename,
              mimetype: f.mimetype,
              sizeBytes: f.size,
              sortIdx: nextIdx++,
            },
          })
        )
      );
      res.status(201).json({ photos: created.map(toPhotoDto) });
    } catch (error) {
      // Cleanup uploaded files on any failure to avoid orphaning bytes.
      for (const f of uploaded) {
        try {
          // Rebuild from the trusted dir + basename of multer's generated
          // filename, not the raw f.path — defense-in-depth + clears the
          // CodeQL js/path-injection taint.
          const safePath = path.join(getTripPhotoDir(), path.basename(f.filename));
          fs.existsSync(safePath) && fs.unlinkSync(safePath);
        } catch (_e) {
          logger.warn({
            operation: "trip_photo_upload_cleanup_error",
            message: "Failed to cleanup orphaned trip photo file",
            context: { filename: f.filename },
          });
        }
      }
      next(error);
    }
  }
);

/** GET /trips/:id/photos/:photoId/file — serve image bytes */
router.get(
  "/trips/:id/photos/:photoId/file",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const photo = await prisma.tripPhoto.findFirst({
        where: { id: req.params.photoId, tripId: req.params.id },
      });
      if (!photo) throw new AppError("Photo not found", 404);
      const filePath = path.join(getTripPhotoDir(), path.basename(photo.filename));
      if (!fs.existsSync(filePath)) throw new AppError("File missing", 404);
      res.type(photo.mimetype);
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }
);

/** PATCH /trips/:id/photos/:photoId — update caption / sortIdx / takenAt */
router.patch(
  "/trips/:id/photos/:photoId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const existing = await prisma.tripPhoto.findFirst({
        where: { id: req.params.photoId, tripId: req.params.id },
      });
      if (!existing) throw new AppError("Photo not found", 404);
      const body = updatePhotoSchema.parse(req.body);
      const photo = await prisma.tripPhoto.update({
        where: { id: req.params.photoId },
        data: {
          ...(body.caption !== undefined && { caption: body.caption }),
          ...(body.takenAt !== undefined && {
            takenAt: body.takenAt ? new Date(body.takenAt) : null,
          }),
          ...(body.sortIdx !== undefined && { sortIdx: body.sortIdx }),
        },
      });
      res.json({ photo: toPhotoDto(photo) });
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /trips/:id/photos/:photoId */
router.delete(
  "/trips/:id/photos/:photoId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const photo = await prisma.tripPhoto.findFirst({
        where: { id: req.params.photoId, tripId: req.params.id },
      });
      if (!photo) throw new AppError("Photo not found", 404);
      await prisma.tripPhoto.delete({ where: { id: req.params.photoId } });
      deleteTripPhotoFile(photo.filename);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

/** POST /trips/:id/cover — upload single image and set as coverImageUrl */
router.post(
  "/trips/:id/cover",
  authenticate,
  requireWriteScope,
  uploadTripCover.single("cover"),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const uploaded = req.file;
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      if (!uploaded) throw new AppError("No cover uploaded", 400);
      // Reuse the trip-photos directory but scope the URL under the
      // trip's REST namespace via a pseudo-photo row, so cover deletion
      // is unified with photo deletion later.
      const photo = await prisma.tripPhoto.create({
        data: {
          tripId: req.params.id,
          filename: uploaded.filename,
          mimetype: uploaded.mimetype,
          sizeBytes: uploaded.size,
          sortIdx: -1, // covers sort below user photos
          caption: "__cover__",
        },
      });
      const coverUrl = `/api/v1/trips/${req.params.id}/photos/${photo.id}/file`;
      const trip = await prisma.trip.update({
        where: { id: req.params.id },
        data: { coverImageUrl: coverUrl },
      });
      res.status(201).json({ trip, coverUrl });
    } catch (error) {
      if (uploaded) {
        try {
          // Rebuild from the trusted dir + basename of multer's generated
          // filename, not the raw uploaded.path — defense-in-depth + clears
          // the CodeQL js/path-injection taint.
          const safePath = path.join(getTripPhotoDir(), path.basename(uploaded.filename));
          fs.existsSync(safePath) && fs.unlinkSync(safePath);
        } catch (_e) {
          logger.warn({
            operation: "trip_cover_upload_cleanup_error",
            message: "Failed to cleanup orphaned trip cover file",
            context: { filename: uploaded.filename },
          });
        }
      }
      next(error);
    }
  }
);

export default router;
