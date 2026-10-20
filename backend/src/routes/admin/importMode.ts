import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import type { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import {
  IMPORT_MODE_HOURS,
  getImportMode,
  startImportMode,
  stopImportMode,
} from "../../services/importMode";

/** Import mode (forgejo#304) — Administration → Instanz. */
const router = Router();

const putSchema = z.discriminatedUnion("enabled", [
  /** `userId` absent or null = every account. */
  z.object({ enabled: z.literal(true), userId: z.string().uuid().nullable().optional() }),
  z.object({ enabled: z.literal(false) }),
]);

router.get("/import-mode", async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ ...(await getImportMode()), hours: IMPORT_MODE_HOURS });
  } catch (error) {
    next(error);
  }
});

router.put("/import-mode", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError("Invalid import mode", 400);
    if (!parsed.data.enabled) {
      res.json({ ...(await stopImportMode(req.userId!)), hours: IMPORT_MODE_HOURS });
      return;
    }
    const userId = parsed.data.userId ?? null;
    if (userId !== null) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw new AppError("User not found", 404);
    }
    res.json({ ...(await startImportMode(req.userId!, userId)), hours: IMPORT_MODE_HOURS });
  } catch (error) {
    next(error);
  }
});

export default router;
