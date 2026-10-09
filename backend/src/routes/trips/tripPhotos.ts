import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

import { uploadReceiptLimiter } from "../../middleware/rateLimit";
import { rejectDemo } from "../../middleware/demoGuard";
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
import {
  listTripPhotosQuerySchema,
  tripPhotoUploadFieldsSchema,
  updateTripPhotoSchema,
} from "../../schemas/tripPhoto";
import { NOT_A_COVER, assertStopOnTrip } from "../../services/trips/photoStation";
import { ingestUploadedPhotos } from "../../services/photos/ingestPhotos";
import { parseCaptureFields, withCaptureFields } from "../../services/photos/captureFields";
import {
  parsePhotoVariant,
  photoFileToServe,
  removeDisplayRendition,
} from "../../services/photos/displayRendition";

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

/** A gallery this large is a library; the picker shows the first thousand. */
const TRIP_PHOTO_LIST_CAP = 1000;

/* ─────────── Photos (iter 7) ─────────── */

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
  // The shared demo account uploads nothing (finding I2): a file it writes
  // is shown to the next visitor, outlives the nightly reseed and fills the
  // data volume. ABOVE multer, so a refused request writes no bytes.
  rejectDemo,
  uploadReceiptLimiter,
  uploadTripPhotos.array("photos", 20),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const uploaded: Express.Multer.File[] = (req.files as Express.Multer.File[] | undefined) ?? [];
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      if (uploaded.length === 0) throw new AppError("No photos uploaded", 400);
      // Checked BEFORE any row is written; a refusal falls through to the
      // cleanup below, so the files multer already stored go too.
      const { stopId } = tripPhotoUploadFieldsSchema.parse(req.body ?? {});
      if (stopId !== undefined) await assertStopOnTrip(userId, req.params.id, stopId);
      // What the client says about the one photo it sent (companion#59),
      // refused here when malformed or beside several files.
      const fields = parseCaptureFields(req.body, uploaded.length);
      // Capture time and position from each file's own metadata, and a JPEG
      // display copy for a HEIC/HEIF original — or a refusal, before any row.
      // EXIF wins; the fields fill only what the file did not say.
      const exif = (await ingestUploadedPhotos(getTripPhotoDir(), uploaded)).map((read) =>
        withCaptureFields(read, fields)
      );

      const last = await prisma.tripPhoto.findFirst({
        where: { tripId: req.params.id },
        orderBy: { sortIdx: "desc" },
        select: { sortIdx: true },
      });
      let nextIdx = (last?.sortIdx ?? -1) + 1;

      const created = await prisma.$transaction(
        uploaded.map((f, i) =>
          prisma.tripPhoto.create({
            data: {
              tripId: req.params.id,
              filename: f.filename,
              mimetype: f.mimetype,
              sizeBytes: f.size,
              sortIdx: nextIdx++,
              stopId: stopId ?? null,
              takenAt: exif[i].takenAt,
              lat: exif[i].lat,
              lon: exif[i].lon,
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
          removeDisplayRendition(getTripPhotoDir(), f.filename);
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

/**
 * GET /trips/:id/photos — the gallery on its own, for a picker that needs the
 * photos and not the whole trip (the journal entry's photo choice).
 *
 * `?stopId=` narrows it to one station. A stop that is not on the trip is a
 * 400, not an empty list: "no photos here" and "you asked about the wrong
 * stop" must not look alike.
 */
router.get(
  "/trips/:id/photos",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await resolveTrip(req.userId!, req.params.id);
      const { stopId } = listTripPhotosQuerySchema.parse(req.query);
      if (stopId !== undefined) await assertStopOnTrip(req.userId!, req.params.id, stopId);
      const rows = await prisma.tripPhoto.findMany({
        where: {
          tripId: req.params.id,
          ...NOT_A_COVER,
          ...(stopId !== undefined && { stopId }),
        },
        orderBy: [{ sortIdx: "asc" }, { createdAt: "asc" }],
        take: TRIP_PHOTO_LIST_CAP,
      });
      res.json({ photos: rows.map(toPhotoDto) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /trips/:id/photos/:photoId/file — serve image bytes.
 *
 * `?variant=display` (default) is what a browser can draw — for a HEIC/HEIF
 * original its JPEG copy; `?variant=original` is the bytes as uploaded
 * (forgejo#192).
 */
router.get(
  "/trips/:id/photos/:photoId/file",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const variant = parsePhotoVariant(req.query);
      const photo = await prisma.tripPhoto.findFirst({
        where: { id: req.params.photoId, tripId: req.params.id },
      });
      if (!photo) throw new AppError("Photo not found", 404);
      const served = await photoFileToServe(
        getTripPhotoDir(),
        photo.filename,
        photo.mimetype,
        variant
      );
      if (!served) throw new AppError("File missing", 404);
      res.type(served.type);
      res.sendFile(served.filePath);
    } catch (error) {
      next(error);
    }
  }
);

/** PATCH /trips/:id/photos/:photoId — update caption / sortIdx / takenAt / stopId */
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
      const body = updateTripPhotoSchema.parse(req.body);
      if (body.stopId) await assertStopOnTrip(userId, req.params.id, body.stopId);
      const photo = await prisma.tripPhoto.update({
        where: { id: req.params.photoId },
        data: {
          ...(body.caption !== undefined && { caption: body.caption }),
          ...(body.takenAt !== undefined && {
            takenAt: body.takenAt ? new Date(body.takenAt) : null,
          }),
          ...(body.sortIdx !== undefined && { sortIdx: body.sortIdx }),
          ...(body.stopId !== undefined && { stopId: body.stopId }),
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
  // The shared demo account uploads nothing (finding I2): a file it writes
  // is shown to the next visitor, outlives the nightly reseed and fills the
  // data volume. ABOVE multer, so a refused request writes no bytes.
  rejectDemo,
  uploadTripCover.single("cover"),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const uploaded = req.file;
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      if (!uploaded) throw new AppError("No cover uploaded", 400);
      // A HEIC/HEIF cover gets its display copy too, or is refused here.
      await ingestUploadedPhotos(getTripPhotoDir(), [uploaded]);
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
          removeDisplayRendition(getTripPhotoDir(), uploaded.filename);
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
