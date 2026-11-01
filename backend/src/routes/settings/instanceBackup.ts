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
/** How many newest completed rows to look through for one that is a run of this server. */
const RECENT = 50;

const router = Router();

router.use(settingsLimiter);

router.get("/", async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [recent, running] = await Promise.all([
      prisma.backup.findMany({
        where: { status: "completed", completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true, metadata: true },
        take: RECENT,
      }),
      prisma.backup.findFirst({ where: { status: "running" }, select: { id: true } }),
    ]);
    // A backup pulled in from the WebDAV share is a row stamped with the day it was
    // imported, not a run of this server: counting it would report an old archive
    // as a fresh backup.
    const last = recent.find(
      (row) => (row.metadata as { source?: unknown } | null)?.source !== "webdav"
    );
    res.json({ completedAt: last?.completedAt?.toISOString() ?? null, running: !!running });
  } catch (error) {
    next(error);
  }
});

export default router;
