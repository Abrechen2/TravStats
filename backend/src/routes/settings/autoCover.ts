/**
 * "Titelbilder automatisch wählen" — the account switch for automatic covers and
 * its undo. Mounted under `/api/v1/settings/auto-cover` (parent: `authenticate` +
 * `requireWriteScope`).
 *
 * `DELETE /covers` removes ONLY covers the server chose (`coverSource = auto`);
 * a person's own cover is never matched by it.
 */
import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { statsLimiter } from "../../middleware/rateLimit";
import {
  autoCoverEnabled,
  queueAutoCover,
  removeAutoCovers,
} from "../../services/coverSuggestions/autoCover";

const router = Router();

const switchSchema = z.object({ enabled: z.boolean() }).strict();

router.get(
  "/",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const [enabled, autoCovers] = await Promise.all([
        autoCoverEnabled(userId),
        prisma.trip.count({ where: { userId, coverSource: "auto" } }),
      ]);
      res.json({ enabled, autoCovers });
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
        update: { autoCoverEnabled: enabled },
        create: { userId, data: {}, autoCoverEnabled: enabled },
      });
      if (enabled) queueAutoCover(userId);
      res.json({ enabled });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/covers",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ removed: await removeAutoCovers(req.userId!) });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
