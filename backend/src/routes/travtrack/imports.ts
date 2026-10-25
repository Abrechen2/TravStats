import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { travTrackImportLimiter } from "../../middleware/travTrackImportLimiter";
import {
  deleteTravTrackImport,
  listTravTrackImports,
  startGpxImport,
} from "../../services/travtrack/imports/fileImport";
import { GPX_IMPORT_MAX_BYTES } from "../../services/travtrack/imports/mapGpx";
import logger from "../../utils/logger";
import { travTrackTier } from "./gate";

/**
 * File imports into TravTrack (TravTrack plan E8): a GPX file goes through the
 * same ingest as the Companion's points. Bare responses (ADR 0001).
 *
 * The file is held in memory only (`memoryStorage`) and never written to disk:
 * its name is a label, nothing on the server is named after it. One file per
 * request, at most `GPX_IMPORT_MAX_BYTES`; the work runs as a job the client
 * polls (`GET /jobs/:id`), since a large file outlasts a request.
 *
 * Tiers: starting an import is `on` (new capture); the list and a delete are
 * `held` — TravTrack off still lets an account see and remove what it has.
 */

const router = Router();

function route(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: GPX_IMPORT_MAX_BYTES, files: 1, fields: 5, fieldSize: 1024, parts: 8 },
});

/** One `file` part, or a refusal by code: an oversized file is 413, anything else malformed 400. */
function oneFile(req: Request, res: Response, next: NextFunction): void {
  fileUpload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(new AppError("The file is too large", 413, "TRACK_FILE_TOO_LARGE"));
    }
    return next(new AppError("The upload could not be read", 400, "VALIDATION_FAILED"));
  });
}

/** POST /travtrack/imports — multipart `file` (GPX) → 202 `{ jobId, importId }`. */
router.post(
  "/travtrack/imports",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  travTrackImportLimiter,
  oneFile,
  route(async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError("No file was uploaded", 400, "VALIDATION_FAILED");
    const started = await startGpxImport(req.userId!, {
      buffer: file.buffer,
      originalName: file.originalname,
    });
    logger.info({ operation: "travtrack.import.start", importId: started.importId });
    res.status(202).json(started);
  })
);

/** GET /travtrack/imports — the account's imports, newest first, each with its points' count. */
router.get(
  "/travtrack/imports",
  authenticate,
  travTrackTier("held"),
  route(async (req, res) => {
    const userId = req.userId!;
    const rows = await listTravTrackImports(userId);
    const counts = await prisma.travTrackPoint.groupBy({
      by: ["origin"],
      where: { userId, origin: { in: rows.map((r) => `gpx:${r.id}`) } },
      _count: { _all: true },
    });
    const countOf = new Map(counts.map((c) => [c.origin, c._count._all]));
    res.json({
      imports: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        fileName: r.fileName,
        status: r.status,
        report: r.report ?? null,
        pointCount: countOf.get(`gpx:${r.id}`) ?? 0,
        fromAt: r.fromAt?.toISOString() ?? null,
        toAt: r.toAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
      })),
    });
  })
);

/** DELETE /travtrack/imports/:id — the import's points go, its row stays as `cancelled`. */
router.delete(
  "/travtrack/imports/:id",
  authenticate,
  travTrackTier("held"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    const { deleted } = await deleteTravTrackImport(req.userId!, String(req.params.id));
    logger.info({ operation: "travtrack.import.delete", deleted });
    res.json({ deleted });
  })
);

export default router;
