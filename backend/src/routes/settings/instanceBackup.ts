import { Router, Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth";
import { settingsLimiter } from "../../middleware/rateLimit";
import { prisma } from "../../db";

/**
 * `GET /api/v1/settings/instance-backup`: the one fact about the SERVER's
 * backup every account may see (settings rebuild R3): when the last one
 * finished, and whether one is running. Nothing else — not a path, a size, a
 * cloud target or an error — because the backup list itself is admin-only and
 * must stay so. Bare response family.
 */
const router = Router();

router.use(settingsLimiter);

router.get("/", async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [last, running] = await Promise.all([
      prisma.backup.findFirst({
        where: { status: "completed", completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true },
      }),
      prisma.backup.findFirst({ where: { status: "running" }, select: { id: true } }),
    ]);
    res.json({ completedAt: last?.completedAt?.toISOString() ?? null, running: !!running });
  } catch (error) {
    next(error);
  }
});

export default router;
