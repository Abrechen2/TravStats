/**
 * One trip as a file, out and back in (spec 2026-10-09 decision 6, S3).
 *
 *   GET  /trips/:id/export          the trip as a `.travstats` ZIP; documents,
 *                                   photos and private fields only when asked
 *   POST /trips/import/preview      a `.travstats` upload → the proposal; writes nothing
 *   POST /trips/import/commit       the same proposal, written in one transaction
 *
 * The uploads go in the multipart field `file`; `tripName` (optional) names
 * a trip the import creates. The proposal is rebuilt on commit from the file
 * itself, never taken from the client. Enveloped family (ADR 0001), like the
 * package import. Mounted before `trips`, so `/trips/import/...` is never
 * read as a trip id.
 */
import { Router, Response, NextFunction, RequestHandler } from "express";
import multer, { MulterError } from "multer";
import { z } from "zod";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { tripFileLimiter } from "../../middleware/rateLimit";
import logger from "../../utils/logger";
import { collectTrip } from "../../services/trip/exchange/collect";
import { commitTripFile } from "../../services/trip/exchange/commit";
import { TRIP_FILE_EXTENSION, TRIP_FILE_LIMITS } from "../../services/trip/exchange/format";
import { buildTripFileProposal } from "../../services/trip/exchange/proposal";
import { readTripArchive } from "../../services/trip/exchange/readArchive";
import { tripFileChoicesSchema } from "../../services/trip/exchange/types";
import {
  buildManifest,
  presentFiles,
  writeTripArchive,
} from "../../services/trip/exchange/writeArchive";

const router = Router();

const flag = z
  .enum(["0", "1"])
  .default("0")
  .transform((v) => v === "1");
export const exportQuerySchema = z.object({
  documents: flag,
  photos: flag,
  private: flag,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TRIP_FILE_LIMITS.maxUploadBytes, files: 1, fields: 5 },
});

/** multer with its size refusal turned into the trip file's own code. */
const uploadFile: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
      next(new AppError("The file is larger than a trip file may be", 413, "TRIP_FILE_TOO_LARGE"));
      return;
    }
    next(err);
  });
};

/** `Reise nach Lissabon` → `reise-nach-lissabon`; ASCII only, for the header. */
export function fileSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "reise";
}

router.get(
  "/trips/:id/export",
  authenticate,
  tripFileLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const options = exportQuerySchema.parse(req.query);
      const collected = presentFiles(await collectTrip(userId, req.params.id, options));
      const now = new Date();
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileSlug(collected.tripName)}-${now.toISOString().slice(0, 10)}${TRIP_FILE_EXTENSION}"`
      );
      await writeTripArchive(collected, buildManifest(options, now), res);
      logger.info({
        operation: "trip_export",
        userId,
        tripId: req.params.id,
        ...options,
        files: collected.files.length,
      });
    } catch (error) {
      if (res.headersSent) {
        logger.error({ operation: "trip_export_stream_failed", err: error });
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      next(error);
    }
  }
);

function readUpload(req: AuthRequest) {
  const file = req.file;
  if (!file) {
    throw new AppError("No file uploaded", 400, "TRIP_FILE_INVALID", "file");
  }
  const choices = tripFileChoicesSchema.parse(
    typeof req.body?.tripName === "string" && req.body.tripName.trim()
      ? { tripName: req.body.tripName }
      : {}
  );
  return { archive: readTripArchive(file.buffer), choices };
}

router.post(
  "/trips/import/preview",
  authenticate,
  requireWriteScope,
  tripFileLimiter,
  uploadFile,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { archive, choices } = readUpload(req);
      const proposal = await buildTripFileProposal(req.userId!, archive, choices);
      res.json({ success: true, data: { proposal } });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/trips/import/commit",
  authenticate,
  requireWriteScope,
  rejectDemo,
  tripFileLimiter,
  uploadFile,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { archive, choices } = readUpload(req);
      const result = await commitTripFile(req.userId!, archive, choices);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
