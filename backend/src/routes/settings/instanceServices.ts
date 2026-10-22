import { Router, Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth";
import { settingsLimiter } from "../../middleware/rateLimit";
import { instanceServicesView } from "../../services/settings/instanceServices";

/**
 * `GET /api/v1/settings/instance-services` — which keyless services the
 * instance runs for every account (forgejo#321, owner item 1). The personal
 * Dienste page lists Transitous, db-rest and OpenRailRouting, which only an
 * admin switches; without this answer an ordinary account saw them with no
 * status at all.
 *
 * Booleans only. The admin settings behind them hold a URL (OpenRailRouting
 * may be a LAN host); no address, key or host name leaves through here.
 * Auth and scope come from the settings router; the limiter is mounted after
 * `authenticate`, so its bucket is the account's. `/api` is `no-store` by
 * default, which this answer keeps.
 */
const router = Router();

router.use(settingsLimiter);

router.get("/", async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await instanceServicesView());
  } catch (error) {
    next(error);
  }
});

export default router;
