import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { immichImportLimiter, statsLimiter } from "../../middleware/rateLimit";
import { deletePlacePhotoFile } from "../../middleware/upload";
import { startJob } from "../../services/jobs/jobRegistry";
import {
  clampPhotoCap,
  PHOTO_CAP_MAX,
  PHOTO_CAP_MIN,
  photoCapFor,
} from "../../services/photoLinking/cap";
import { trimAutoLinks } from "../../services/photoLinking/trimAuto";
import { autoLinkEverything } from "../../services/photoLinking/entryPhotos";
import { autoLinkEnabled } from "../../services/places/visitPhotoAutoLink";
import { toPhotoSourceKind } from "../../services/photoSource/connection";

/**
 * Automatic photo links for place visits — the account switch, the one-off run
 * over every existing visit, and "remove all automatically linked" per visit.
 *
 * Mounted before `places/visitPhotos.ts`: `DELETE /visits/:visitId/photos/auto`
 * must not be read as a photo id there.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const switchSchema = z.object({ enabled: z.boolean() }).strict();
export const capSchema = z
  .object({ cap: z.number().int().min(PHOTO_CAP_MIN).max(PHOTO_CAP_MAX) })
  .strict();
const visitParams = z.object({ visitId: z.string().uuid() });

function startRun(userId: string) {
  return startJob("placeVisitPhotos.autoLink", userId, async (report) =>
    autoLinkEverything(userId, report)
  );
}

function startTrim(userId: string) {
  return startJob("placeVisitPhotos.trim", userId, async (report) => trimAutoLinks(userId, report));
}

router.get(
  "/visits/photos/auto-link",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const row = await prisma.userSettings.findUnique({
        where: { userId: req.userId! },
        select: {
          autoLinkVisitPhotos: true,
          visitPhotoAutoLinkLastRun: true,
          photoAutoLinkCap: true,
        },
      });
      res.json({
        success: true,
        data: {
          enabled: row?.autoLinkVisitPhotos ?? true,
          cap: await photoCapFor(req.userId!),
          capMin: PHOTO_CAP_MIN,
          capMax: PHOTO_CAP_MAX,
          lastRun: row?.visitPhotoAutoLinkLastRun ?? null,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/** Switching on also runs the pass over the existing visits; the reply names the job. */
router.put(
  "/visits/photos/auto-link",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = switchSchema.safeParse(req.body ?? {});
      if (!body.success) throw new AppError(body.error.message, 400);
      const userId = req.userId!;
      const saved = await prisma.userSettings.updateMany({
        where: { userId },
        data: { autoLinkVisitPhotos: body.data.enabled },
      });
      if (saved.count === 0) throw new AppError("Settings not found", 404);
      const job = body.data.enabled ? startRun(userId) : null;
      res.json({ success: true, data: { enabled: body.data.enabled, jobId: job?.id ?? null } });
    } catch (error) {
      next(error);
    }
  }
);

/** The per-visit/entry limit, 5–10. A lower one trims what is linked already (a job). */
router.put(
  "/visits/photos/auto-link/cap",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = capSchema.safeParse(req.body ?? {});
      if (!body.success) throw new AppError(body.error.message, 400);
      const userId = req.userId!;
      const cap = clampPhotoCap(body.data.cap);
      const saved = await prisma.userSettings.updateMany({
        where: { userId },
        data: { photoAutoLinkCap: cap },
      });
      if (saved.count === 0) throw new AppError("Settings not found", 404);
      res.json({ success: true, data: { cap, jobId: startTrim(userId).id } });
    } catch (error) {
      next(error);
    }
  }
);

/** Trim every visit's and entry's automatic links to the cap; idempotent. */
router.post(
  "/visits/photos/auto-link/trim",
  immichImportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(202).json({ success: true, data: { jobId: startTrim(req.userId!).id } });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/visits/photos/auto-link/run",
  immichImportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      // Refused up front: "switched off" is an answer, not a job that does nothing.
      if (!(await autoLinkEnabled(userId))) {
        res.status(409).json({ error: "disabled" });
        return;
      }
      res.status(202).json({ success: true, data: { jobId: startRun(userId).id } });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * "Alle automatisch verknüpften entfernen" for one visit. Each removed link is
 * recorded as a refusal, or the next pass would put it straight back.
 */
router.delete(
  "/visits/:visitId/photos/auto",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = visitParams.safeParse(req.params);
      if (!params.success) throw new AppError("Invalid visit id", 400);
      const userId = req.userId!;
      const visit = await prisma.placeVisit.findFirst({
        where: { id: params.data.visitId, userId },
        select: { id: true },
      });
      if (!visit) throw new AppError("Visit not found", 404);
      const rows = await prisma.placeVisitPhoto.findMany({
        where: { placeVisitId: visit.id, provenance: "auto" },
        select: { id: true, filename: true, immichAssetId: true, provider: true },
      });
      await prisma.$transaction([
        prisma.visitPhotoRefusal.createMany({
          data: rows.flatMap((r) =>
            r.immichAssetId
              ? [
                  {
                    userId,
                    placeVisitId: visit.id,
                    kind: "library",
                    provider: toPhotoSourceKind(r.provider),
                    suggestionId: r.immichAssetId,
                  },
                ]
              : []
          ),
          skipDuplicates: true,
        }),
        prisma.placeVisitPhoto.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }),
      ]);
      for (const r of rows) if (r.filename) deletePlacePhotoFile(r.filename);
      res.json({ success: true, data: { removed: rows.length } });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
