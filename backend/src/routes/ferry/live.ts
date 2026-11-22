import { Router, type Response, type NextFunction } from "express";
import { authenticate, type AuthRequest } from "../../middleware/auth";
import { rejectDemoQuota } from "../../middleware/demoGuard";
import { photonSearchLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import { aisConfigured, lookupVessel } from "../../services/ferry/aisStream";
import { isServiceDisabledByAdmin } from "../../services/externalServices/policy";
import { ensureVesselMmsi, loadVesselJourney } from "../../services/vessel/vesselJourney";
const router = Router();
router.use(authenticate);
router.get("/live-availability", async (_req, res) =>
  res.json({
    success: true,
    data: {
      configured: aisConfigured() && !(await isServiceDisabledByAdmin("aisstream")),
      provider: "AISStream",
    },
  })
);
router.get(
  "/:id/live-position",
  rejectDemoQuota,
  photonSearchLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // `?mmsi=` from an older client is ignored (2026-11-22): the crossing's
      // MMSI is the server's, resolved from the vessel name, so a crossing is
      // never a free AIS proxy for whatever number a request names.
      const userId = req.userId!;
      const journey = await loadVesselJourney("ferry", req.params.id, userId);
      if (!journey) throw new AppError("Crossing not found", 404);
      const { mmsi } = await ensureVesselMmsi(journey, new Date(), { ais: false });
      res.setHeader("Cache-Control", "no-store");
      if (!mmsi) {
        res.json({ success: true, data: { status: "unresolved", position: null } });
        return;
      }
      // An admin who switched the service off means it: no socket, no request.
      const result = (await isServiceDisabledByAdmin("aisstream"))
        ? { status: "notConfigured" as const, position: null }
        : await lookupVessel(mmsi, userId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);
export default router;
