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
      const parsed = z
        .object({
          mmsi: z
            .string()
            .regex(/^\d{9}$/)
            .optional(),
        })
        .safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("MMSI must contain nine digits", 400, "FERRY_INVALID_INPUT", "mmsi");
      }
      const userId = req.userId!;
      const own = await prisma.ferryJourney.findFirst({
        where: { id: req.params.id, userId },
        select: { id: true, vesselMmsi: true },
      });
      if (!own) throw new AppError("Crossing not found", 404);
      // The MMSI belongs to the crossing, not to the request: free input made
      // any crossing a general AIS proxy for any vessel. A crossing without
      // one takes the first MMSI that answers; the editor can change it.
      const asked = parsed.data.mmsi;
      if (own.vesselMmsi !== null && asked !== undefined && asked !== own.vesselMmsi) {
        throw new AppError(
          "This crossing is bound to another vessel; change it in the crossing first",
          400,
          "FERRY_INVALID_INPUT",
          "mmsi"
        );
      }
      const mmsi = own.vesselMmsi ?? asked;
      if (mmsi === undefined) {
        throw new AppError("MMSI must contain nine digits", 400, "FERRY_INVALID_INPUT", "mmsi");
      }
      const result = await lookupVessel(mmsi, userId);
      if (result.status === "ok" && own.vesselMmsi === null) {
        // share-exempt: binds the vessel MMSI for the live position — private
        await prisma.ferryJourney.updateMany({
          where: { id: own.id, userId, vesselMmsi: null },
          data: { vesselMmsi: mmsi },
        });
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
export default router;
