import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authenticate, type AuthRequest } from "../../middleware/auth";
import { rejectDemoQuota } from "../../middleware/demoGuard";
import { photonSearchLimiter } from "../../middleware/rateLimit";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { aisConfigured, lookupVessel } from "../../services/ferry/aisStream";
const router = Router();
router.use(authenticate);
router.get("/live-availability", (_req, res) =>
  res.json({ success: true, data: { configured: aisConfigured(), provider: "AISStream" } })
);
router.get(
  "/:id/live-position",
  rejectDemoQuota,
  photonSearchLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = z.object({ mmsi: z.string().regex(/^\d{9}$/) }).safeParse(req.query);
      if (!parsed.success) throw new AppError("MMSI must contain nine digits", 400);
      const own = await prisma.ferryJourney.findFirst({
        where: { id: req.params.id, userId: req.userId! },
        select: { id: true },
      });
      if (!own) throw new AppError("Crossing not found", 404);
      res.setHeader("Cache-Control", "no-store");
      res.json({ success: true, data: await lookupVessel(parsed.data.mmsi) });
    } catch (error) {
      next(error);
    }
  }
);
export default router;
