import { Router, type NextFunction, type Response } from "express";

import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { calendarFeedIssueLimiter } from "../middleware/calendarFeedRateLimit";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { feedStatus, issueFeed, revokeFeed } from "../services/calendarFeed/feedService";
import { chooseFeedBaseUrl, type FeedBaseUrl } from "../services/calendarFeed/feedHost";
import { getInstanceSettings } from "../services/instanceSettingsService";

/**
 * `/api/v1/calendar-feed` — the owner's side of the calendar subscription
 * (forgejo#310): whether a URL exists, a new one, and revoking it. The URL
 * itself (`routes/calendarFeedPublic.ts`) needs no session.
 *
 * Enveloped (`{success, data}`, ADR 0001), like the share links it mirrors.
 * The URL is a credential for the account's whole travel calendar, and an API
 * token minting credentials is the escalation `settings/tokens.ts` already
 * refuses — so a generic API token is refused outright. The one exception is
 * the paired Companion (a token minted by device pairing, `deviceId` set,
 * write scope): it may read the state and issue the URL so the phone can
 * offer the subscription, but revoking stays with a browser session. The
 * shared demo account may read but not issue or revoke — every visitor of a
 * public instance is that account.
 */

/** What a paired device's token may do here; DELETE is not among them. */
const COMPANION_METHODS = new Set(["GET", "HEAD", "POST"]);

/** A paired device's token with write scope, on a method it may use. */
const isCompanionCall = (req: AuthRequest): boolean =>
  !!req.apiToken?.deviceId && req.apiToken.scope !== "read" && COMPANION_METHODS.has(req.method);

const router = Router();
router.use(authenticate);
router.use(requireWriteScope);
router.use(rejectDemoWrites);
router.use((req: AuthRequest, _res: Response, next: NextFunction) => {
  if (req.apiToken && !isCompanionCall(req)) {
    next(new AppError("The calendar feed is managed from a browser session", 403));
    return;
  }
  next();
});

/**
 * The address the link is built on: a DNS name over an IP where one is known
 * (`feedHost.ts`). Unlike `getPublicBaseUrl`, which every other link keeps.
 */
async function feedBaseUrl(req: AuthRequest): Promise<FeedBaseUrl> {
  const { publicUrl, frontendUrl } = await getInstanceSettings();
  // `req.protocol` honours `trust proxy` (index.ts), as in `getPublicBaseUrl`.
  const host = req.get("host") ?? `localhost:${process.env.PORT ?? "8000"}`;
  return chooseFeedBaseUrl({ publicUrl, frontendUrl, requestUrl: `${req.protocol}://${host}` });
}

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
    const { baseUrl, reachableFromInternet } = await feedBaseUrl(req);
    const status = await feedStatus(req.userId!, baseUrl);
    res.json({ success: true, data: { ...status, reachableFromInternet } });
  })
);

router.post(
  "/",
  calendarFeedIssueLimiter,
  handle(async (req, res) => {
    const { baseUrl, reachableFromInternet } = await feedBaseUrl(req);
    const issued = await issueFeed(req.userId!, baseUrl);
    res.status(201).json({ success: true, data: { ...issued, reachableFromInternet } });
  })
);

router.delete(
  "/",
  handle(async (req, res) => {
    res.json({ success: true, data: { revoked: await revokeFeed(req.userId!) } });
  })
);

export default router;
