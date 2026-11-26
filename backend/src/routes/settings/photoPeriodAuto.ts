/**
 * "Zeitraum automatisch verknüpfen für Reisen ohne Album" — the account switch of
 * spec 2026-11-26-trip-photo-links.md decision 4, default off. Mounted under
 * `/api/v1/settings/photo-period-auto` (parent: `authenticate` + `requireWriteScope`).
 */
import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { statsLimiter } from "../../middleware/rateLimit";

const router = Router();

const switchSchema = z.object({ enabled: z.boolean() }).strict();

router.get(
  "/",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const row = await prisma.userSettings.findUnique({
        where: { userId: req.userId! },
        select: { photoPeriodAutoLink: true },
      });
      res.json({ enabled: row?.photoPeriodAutoLink ?? false });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  "/",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const { enabled } = switchSchema.parse(req.body);
      await prisma.userSettings.upsert({
        where: { userId },
        update: { photoPeriodAutoLink: enabled },
        create: { userId, data: {}, photoPeriodAutoLink: enabled },
      });
      res.json({ enabled });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
