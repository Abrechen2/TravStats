import { Router, type NextFunction, type Response } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { calendarFeedIssueLimiter } from "../middleware/calendarFeedRateLimit";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { feedStatus, issueFeed, revokeFeed } from "../services/calendarFeed/feedService";
import { getPublicBaseUrl } from "../services/instanceSettingsService";

/**
 * `/api/v1/calendar-feed` — the owner's side of the calendar subscription
 * (forgejo#310): whether a URL exists, a new one, and revoking it. The URL
 * itself (`routes/calendarFeedPublic.ts`) needs no session.
 *
 * Enveloped (`{success, data}`, ADR 0001), like the share links it mirrors.
 * Browser sessions only: the URL is a credential for the account's whole
 * travel calendar, and an API token minting credentials is the escalation
 * `settings/tokens.ts` already refuses. The shared demo account may read but
 * not issue or revoke — every visitor of a public instance is that account.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);
router.use(rejectDemoWrites);
router.use((req: AuthRequest, _res: Response, next: NextFunction) => {
  if (req.apiToken) {
    next(new AppError("The calendar feed is managed from a browser session", 403));
    return;
  }
  next();
});

type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle =
  (fn: Handler) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

router.get(
  "/",
  handle(async (req, res) => {
    res.json({ success: true, data: await feedStatus(req.userId!) });
  })
);

router.post(
  "/",
  calendarFeedIssueLimiter,
  handle(async (req, res) => {
    const issued = await issueFeed(req.userId!, await getPublicBaseUrl(req));
    res.status(201).json({ success: true, data: issued });
  })
);

router.delete(
  "/",
  handle(async (req, res) => {
    res.json({ success: true, data: { revoked: await revokeFeed(req.userId!) } });
  })
);

export default router;
