import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../../middleware/auth";
import logger from "../../utils/logger";
import {
  getConsent,
  setConsent,
  getInstallId,
  getStatsBaseUrl,
  usageStatsTick,
  sendErasure,
} from "../../services/usageStats";

const router = Router();

/** The API never sets consent back to `unset` — that state only exists pre-decision. */
export const usageStatsConsentSchema = z.object({
  consent: z.enum(["granted", "denied"]),
});

/**
 * Apply a consent decision.
 *
 * On denial we erase the server-side row BEFORE persisting the local denial: a
 * crash between the two must leave the user erased, not merely marked as erased.
 * Both network calls are best-effort and never fail the request.
 */
export async function applyConsentChange(consent: "granted" | "denied"): Promise<void> {
  const baseUrl = getStatsBaseUrl();

  if (consent === "denied") {
    const installId = await getInstallId();
    if (baseUrl && installId) {
      try {
        await sendErasure(installId, baseUrl);
      } catch (error) {
        logger.debug({ error }, "usage-stats erasure on withdrawal failed");
      }
    }
    await setConsent("denied");
    return;
  }

  await setConsent("granted");
  if (!baseUrl) return;
  try {
    await usageStatsTick();
  } catch (error) {
    logger.debug({ error }, "usage-stats immediate ping after grant failed");
  }
}

// GET /api/v1/admin/usage-stats
router.get("/usage-stats", async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [consent, installId] = await Promise.all([getConsent(), getInstallId()]);
    res.json({
      consent,
      installId,
      endpointConfigured: getStatsBaseUrl() !== "",
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v1/admin/usage-stats
router.put("/usage-stats", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { consent } = usageStatsConsentSchema.parse(req.body);
    await applyConsentChange(consent);
    const installId = await getInstallId();
    res.json({ consent, installId, endpointConfigured: getStatsBaseUrl() !== "" });
  } catch (error) {
    next(error);
  }
});

export default router;
