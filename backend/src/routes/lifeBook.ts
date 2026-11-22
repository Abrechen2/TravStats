/**
 * The life book (docs/superpowers/specs/2026-11-22-life-book.md): one offline
 * HTML chronicle of a year, a trip or everything. Built as a job
 * (`GET /jobs/:id`), downloaded afterwards. Enveloped response family.
 *
 *   POST /me/life-book             start a build -> { jobId }
 *   GET  /me/life-book/:exportId   download the finished HTML
 */
import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { authenticate, AuthRequest, requireWriteScope } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { lifeBookLimiter } from "../middleware/meExportLimiter";
import { prisma } from "../db";
import {
  checkLifeBookRequest,
  findLifeBook,
  startLifeBook,
} from "../services/lifeBook/lifeBookJobs";

const router = Router();

export const lifeBookBodySchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all"), lang: z.enum(["de", "en"]).default("de") }),
  z.object({
    scope: z.literal("year"),
    year: z.number().int().min(1900).max(2200),
    lang: z.enum(["de", "en"]).default("de"),
  }),
  z.object({
    scope: z.literal("trip"),
    tripId: z.string().uuid(),
    lang: z.enum(["de", "en"]).default("de"),
  }),
]);

router.post(
  "/",
  authenticate,
  rejectDemo,
  requireWriteScope,
  lifeBookLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = lifeBookBodySchema.safeParse(req.body);
      if (!parsed.success)
        throw new AppError("Invalid life book request", 400, "LIFE_BOOK_INVALID");
      const body = parsed.data;
      const request = {
        lang: body.lang,
        scope:
          body.scope === "year"
            ? { kind: "year" as const, year: body.year }
            : body.scope === "trip"
              ? { kind: "trip" as const, tripId: body.tripId }
              : { kind: "all" as const },
      };
      await checkLifeBookRequest(req.userId!, request);
      const user = await prisma.user.findUnique({
        where: { id: req.userId! },
        select: { username: true },
      });
      if (!user) throw new AppError("Account not found", 404, "LIFE_BOOK_NOT_FOUND");
      const job = startLifeBook(req.userId!, user.username, request);
      res.status(202).json({ success: true, data: { jobId: job.id } });
    } catch (error) {
      next(error);
    }
  }
);

router.get("/:exportId", authenticate, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().safeParse(req.params.exportId);
    const stored = id.success ? findLifeBook(id.data, req.userId!) : null;
    if (!stored) throw new AppError("Life book not found", 404, "LIFE_BOOK_NOT_FOUND");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
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
});

export default router;
