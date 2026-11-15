import { Router, Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth";
import { settingsLimiter } from "../../middleware/rateLimit";
import { runPublicUrlCheck } from "../../services/readiness/publicUrlProbe";

/**
 * `POST /api/v1/admin/public-url/check` — probe the instance's own public URL
 * now (readiness spec 2026-11-14 §12). Bare response family, like the rest of
 * the admin settings. A probe that could not run (`NO_PUBLIC_URL`,
 * `OUTBOUND_DISABLED`) is still a 200 with its own `errorCode`: the request
 * succeeded, the answer is "nothing to check".
 */
const router = Router();

router.post(
  "/check",
  settingsLimiter,
  async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await runPublicUrlCheck());
    } catch (error) {
      next(error);
    }
  }
);

export default router;
