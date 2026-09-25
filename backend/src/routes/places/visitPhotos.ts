import fs from "fs";
import path from "path";
import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { createHash } from "crypto";
import fsp from "fs/promises";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import {
  uploadPlacePhotos,
  getPlacePhotoDir,
  deletePlacePhotoFile,
  getTripPhotoDir,
} from "../../middleware/upload";
import {
  immichImportLimiter,
  immichProxyLimiter,
  uploadReceiptLimiter,
} from "../../middleware/rateLimit";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { assetSizeSchema } from "../../schemas/immich";
import { sendPlaceholder, streamAsset } from "../../services/immich/assetStream";
import { createImmichClient } from "../../services/immich/immichClient";
import { getImmichConnection } from "../../services/immich/immichResolver";
import { ImmichError } from "../../services/immich/types";
import { linkVisitPhotosToImmich } from "../../services/places/visitPhotoImmichLink";
import { toPhotoDto } from "./visitPhotoDto";

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
  // The shared demo account uploads nothing (finding I2): a file it writes
  // is shown to the next visitor, outlives the nightly reseed and fills the
  // data volume. ABOVE multer, so a refused request writes no bytes.
  rejectDemo,
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

      /**
       * The identity of the bytes, so this copy can later become a link.
       *
       * Forgejo #21: the Companion uploads a place-visit photo as a TEMPORARY
       * copy and tells the user it will be swapped for a library link. Matching
       * a row to an Immich asset afterwards needs something exact; filename,
       * size and creation time work often and not always.
       *
       * SHA-1, base64 — the same encoding Immich reports in `asset.checksum`,
       * so a comparison is a string equality rather than a re-derivation. SHA-1
       * is chosen for THAT reason and not as a security claim: nothing here
       * depends on it being hard to forge, and the value is computed from the
       * bytes on disk rather than accepted from the client, which is what makes
       * it worth storing at all.
       *
       * A checksum that cannot be computed must not cost the user their upload,
       * so it falls back to null and the row is still written.
       */
      const checksums = await Promise.all(
        uploaded.map(async (file) => {
          try {
            const bytes = await fsp.readFile(
              path.join(getPlacePhotoDir(), path.basename(file.filename))
            );
            return createHash("sha1").update(bytes).digest("base64");
          } catch (error) {
            logger.warn({
              operation: "place_photo_checksum_failed",
              message: "Stored a photo without a checksum; a later Immich match will be heuristic",
              context: { filename: file.filename },
              error: { message: error instanceof Error ? error.message : "Unknown error" },
            });
            return null;
          }
        })
      );

      const created = await prisma.$transaction(
        uploaded.map((file, i) =>
          prisma.placeVisitPhoto.create({
            data: {
              placeVisitId: req.params.visitId,
              filename: file.filename,
              mimetype: file.mimetype,
              sizeBytes: file.size,
              checksum: checksums[i],
              sortIdx: nextIdx++,
            },
          })
        )
      );

      logger.info(
        {
          operation: "place_photo_upload",
          userId,
          visitId: req.params.visitId,
          count: created.length,
        },
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

/**
 * The photo's bytes: the copy on disk, or — once it has become a link
 * (forgejo#21) — the Immich asset stored on this row. The row is the grant: the
 * visit is the caller's, the photo is that visit's, and the asset id comes from
 * the row, never from the request.
 */
router.get(
  "/visits/:visitId/photos/:photoId/file",
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveVisit(req.params.visitId, userId);
      const photo = await prisma.placeVisitPhoto.findFirst({
        where: { id: req.params.photoId, placeVisitId: req.params.visitId },
      });
      if (!photo) throw new AppError("Photo not found", 404);

      // A link to one of the caller's trip photographs: the trip photo's own
      // file, looked up through the caller's trips — the FK proves the photo
      // exists, not whose it is.
      if (photo.filename === null && photo.tripPhotoId) {
        const tripPhoto = await prisma.tripPhoto.findFirst({
          where: { id: photo.tripPhotoId, trip: { userId } },
          select: { filename: true, mimetype: true },
        });
        if (!tripPhoto) throw new AppError("Photo not found", 404);
        const tripFile = path.join(getTripPhotoDir(), path.basename(tripPhoto.filename));
        if (!fs.existsSync(tripFile)) throw new AppError("File missing", 404);
        res.setHeader("Cache-Control", "private, max-age=3600");
        res.type(tripPhoto.mimetype);
        res.sendFile(tripFile);
        return;
      }

      if (photo.filename === null) {
        if (!photo.immichAssetId) throw new AppError("File missing", 404);
        const size = assetSizeSchema.safeParse(req.query.size ?? "preview");
        if (!size.success) throw new AppError("Invalid size", 400);
        const etag = `"${photo.immichAssetId}-${size.data}"`;
        if (req.headers["if-none-match"] === etag) {
          res.status(304).end();
          return;
        }
        const conn = await getImmichConnection(userId);
        if (!conn) {
          res.status(409).json({ error: "notConfigured" });
          return;
        }
        await streamAsset(res, createImmichClient(conn), photo.immichAssetId, size.data, etag);
        return;
      }

      const filePath = path.join(getPlacePhotoDir(), path.basename(photo.filename));
      if (!fs.existsSync(filePath)) throw new AppError("File missing", 404);

      // `private`, deliberately overriding the global `no-store` on /api: these
      // bytes are one user's photo, and a shared cache must never be allowed to
      // hold them. See the cache-control note in CLAUDE.md.
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.type(photo.mimetype);
      res.sendFile(filePath);
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
 * Turn the caller's photo copies into Immich links, where the library holds the
 * same bytes (forgejo#21). Rare and heavy — one search per photo against the
 * user's Immich — so it shares the import limiter.
 */
router.post(
  "/visits/photos/immich-link",
  immichImportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const outcome = await linkVisitPhotosToImmich(req.userId!);
      if (outcome.kind === "notConfigured") {
        res.status(409).json({ error: "notConfigured" });
        return;
      }
      res.json({ success: true, data: { checked: outcome.checked, linked: outcome.linked } });
    } catch (error) {
      if (error instanceof ImmichError) {
        res.status(502).json({ error: error.kind });
        return;
      }
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
      if (photo.filename) deletePlacePhotoFile(photo.filename);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
