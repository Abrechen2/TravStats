import { Router, Response, NextFunction } from "express";
import archiver from "archiver";
import multer from "multer";
import { unzipSync } from "fflate";
import { z } from "zod";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import { trackArchiveLimiter } from "../../middleware/rateLimit";
import { FILE_LIMITS } from "../../config/constants";
import { gpxFileName, trackToGpx } from "../../services/tour/tracks/gpxArchive";
import {
  importTrackArchive,
  type ArchiveFile,
} from "../../services/tour/tracks/trackArchiveImport";
import { resolveRouteFromRequest } from "./tourRoutes";
import { resolveTrack } from "./tourTracks";
import logger from "../../utils/logger";

const router = Router();

/**
 * Bounds on what an import may unpack. A ZIP states each entry's unpacked
 * size before it is inflated, so an entry past the per-file limit — or one
 * that would push the whole past the total — is refused unread: a few
 * kilobytes of archive must not become gigabytes of memory.
 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const TRACK_FILE = /\.(gpx|tcx|fit)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 50 },
});

/** One uploaded file, or the track files inside an uploaded ZIP. */
function unpack(file: Express.Multer.File): ArchiveFile[] {
  const isZip = file.buffer.length > 3 && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
  if (!isZip) return [{ name: file.originalname, content: file.buffer }];

  let count = 0;
  let total = 0;
  let refused = false;
  const entries = unzipSync(new Uint8Array(file.buffer), {
    filter: (entry) => {
      if (!TRACK_FILE.test(entry.name) || entry.name.startsWith("__MACOSX/")) return false;
      count += 1;
      total += entry.originalSize;
      if (
        count > MAX_FILES ||
        total > MAX_TOTAL_BYTES ||
        entry.originalSize > FILE_LIMITS.GPX_TRACK_MAX_SIZE
      ) {
        refused = true;
        return false;
      }
      return true;
    },
  });
  if (refused) throw new AppError("archive_too_large", 413);
  return Object.entries(entries).map(([name, bytes]) => ({ name, content: Buffer.from(bytes) }));
}

/**
 * GET …/tracks/:trackId/gpx — one recording as a GPX file, with the
 * measurements TravStats keeps attached (`gpxArchive.ts`). Ownership runs
 * through the same resolvers as every other track route.
 */
router.get(
  ["/trips/:id/routes/:routeId/tracks/:trackId/gpx", "/tours/:routeId/tracks/:trackId/gpx"],
  authenticate,
  requireWriteScope,
  trackArchiveLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const routeId = await resolveRouteFromRequest(req.userId!, req);
      const track = await resolveTrack(routeId, req.params.trackId);
      const tour = await prisma.tripRoute.findUniqueOrThrow({
        where: { id: routeId },
        select: { id: true, name: true, kind: true, activity: true, mode: true },
      });
      res.setHeader("Content-Type", "application/gpx+xml; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${gpxFileName(tour.name, track.startedAt)}"`
      );
      res.send(trackToGpx(tour, track));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /track-archive — every recording of every tour and roadtrip the caller
 * owns, one GPX each, as a ZIP. Streamed, one route at a time, so a long
 * logbook never sits in memory whole.
 */
router.get(
  "/track-archive",
  authenticate,
  requireWriteScope,
  trackArchiveLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routes = await prisma.tripRoute.findMany({
        where: { userId, tracks: { some: {} } },
        select: { id: true, name: true, kind: true, activity: true, mode: true },
        orderBy: { createdAt: "asc" },
      });
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="travstats-aufzeichnungen-${stamp}.zip"`
      );

      const zip = archiver("zip", { zlib: { level: 6 } });
      zip.on("error", (err) => next(err));
      zip.pipe(res);
      const used = new Set<string>();
      let count = 0;
      for (const route of routes) {
        const tracks = await prisma.tripRouteTrack.findMany({
          where: { routeId: route.id },
          orderBy: { startedAt: "asc" },
        });
        for (const track of tracks) {
          let name = gpxFileName(route.name, track.startedAt);
          for (let n = 2; used.has(name); n++) {
            name = gpxFileName(route.name, track.startedAt, `-${n}`);
          }
          used.add(name);
          zip.append(trackToGpx(route, track), { name });
          count += 1;
        }
      }
      logger.info({ operation: "tour.trackArchive.export", userId, count });
      await zip.finalize();
    } catch (error) {
      next(error);
    }
  }
);

const importFieldsSchema = z.object({
  dryRun: z.enum(["true", "false"]).default("true"),
});

/**
 * POST /track-archive/import — GPX, TCX or FIT files, or ZIPs of them, in the
 * multipart field `files`. `dryRun` (default true) reports per file what
 * would happen and writes nothing; send `dryRun=false` to apply. The rules
 * of placement are in `trackArchiveImport.ts`.
 */
router.post(
  "/track-archive/import",
  authenticate,
  requireWriteScope,
  rejectDemo,
  trackArchiveLimiter,
  upload.array("files"),
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const fields = importFieldsSchema.safeParse(req.body ?? {});
      if (!fields.success) throw new AppError("dryRun must be true or false", 400);
      const uploaded = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (uploaded.length === 0) throw new AppError("No file uploaded", 400);

      const files = uploaded.flatMap(unpack);
      if (files.length > MAX_FILES) throw new AppError("archive_too_large", 413);
      const dryRun = fields.data.dryRun === "true";
      const outcomes = await importTrackArchive(req.userId!, files, dryRun);

      logger.info({
        operation: "tour.trackArchive.import",
        dryRun,
        files: files.length,
        created: outcomes.filter((o) => o.action !== "error" && o.action !== "duplicate").length,
      });
      res.json({ dryRun, files: outcomes });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
