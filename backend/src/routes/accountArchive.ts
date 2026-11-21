/**
 * The account archive (forgejo#433): one account as a ZIP with every record and
 * every file, to move it to another TravStats server, and the import that reads
 * such a ZIP into an EMPTY account. Both run as jobs (`GET /jobs/:id`).
 * Enveloped response family.
 *
 *   GET  /me/account-archive                     can this account take an import?
 *   POST /me/account-archive/export              start an export -> { jobId }
 *   GET  /me/account-archive/export/:exportId    download the finished ZIP
 *   POST /me/account-archive/import              upload a ZIP (field `archive`) -> { jobId }
 */
import { Router, Response, NextFunction } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { z } from "zod";

import {
  authenticate,
  AuthRequest,
  requireBrowserSession,
  requireWriteScope,
} from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { accountArchiveLimiter } from "../middleware/meExportLimiter";
import { prisma } from "../db";
import {
  findExport,
  importReadiness,
  startAccountExport,
  ensureWorkDir,
  startAccountImport,
} from "../services/accountArchive/archiveJobs";
import { archiveMaxBytes } from "../services/accountArchive/format";

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureWorkDir().then(
        (dir) => cb(null, dir),
        (err: Error) => cb(err, "")
      );
    },
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.upload`),
  }),
  limits: { fileSize: archiveMaxBytes(), files: 1, fields: 2, parts: 3 },
});

function receiveArchive(req: AuthRequest, res: Response, next: NextFunction): void {
  upload.single("archive")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      next(new AppError("The account archive is too large", 413, "ACCOUNT_ARCHIVE_TOO_LARGE"));
      return;
    }
    next(err);
  });
}

router.get("/", authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const readiness = await importReadiness(req.userId!);
    res.json({ success: true, data: { ...readiness, maxBytes: archiveMaxBytes() } });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/export",
  authenticate,
  // The shared demo account is sample data on a public instance; nothing to move.
  rejectDemo,
  requireWriteScope,
  accountArchiveLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.userId! },
        select: { username: true },
      });
      if (!user) throw new AppError("Account not found", 404, "ACCOUNT_ARCHIVE_NOT_FOUND");
      const job = startAccountExport(req.userId!, user.username);
      res.status(202).json({ success: true, data: { jobId: job.id } });
    } catch (error) {
      next(error);
    }
  }
);

const exportParams = z.object({ exportId: z.string().uuid() });

router.get(
  "/export/:exportId",
  authenticate,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = exportParams.safeParse(req.params);
      const stored = parsed.success ? findExport(parsed.data.exportId, req.userId!) : null;
      if (!stored) throw new AppError("Export not found", 404, "ACCOUNT_ARCHIVE_NOT_FOUND");
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(stored.filename)}`
      );
      res.sendFile(stored.path, (err) => {
        if (err && !res.headersSent) next(err);
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/import",
  authenticate,
  rejectDemo,
  requireWriteScope,
  requireBrowserSession,
  accountArchiveLimiter,
  receiveArchive,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new AppError("No archive uploaded", 400, "ACCOUNT_ARCHIVE_INVALID");
      const job = startAccountImport(req.userId!, req.file.path);
      res.status(202).json({ success: true, data: { jobId: job.id } });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
