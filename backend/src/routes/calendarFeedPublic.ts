import { Router, type NextFunction, type Request, type Response } from "express";

import { calendarFeedReadLimiter } from "../middleware/calendarFeedRateLimit";
import { AppError } from "../middleware/errorHandler";
import { buildFeed, resolveFeedOwner } from "../services/calendarFeed/feedService";
import { tokenOfFeedPath } from "../services/calendarFeed/feedPath";
import { getPublicBaseUrl } from "../services/instanceSettingsService";
import logger from "../utils/logger";

/**
 * `GET /api/v1/calendar/<token>.ics` — the calendar subscription (forgejo#310).
 *
 * No cookie and no session, by design: a calendar app sends a plain GET and
 * nothing else, so the token in the path IS the permission. It answers only
 * the token owner's entries; every failure — malformed, unknown, revoked, the
 * beta switch off — is the same 404 `CALENDAR_FEED_NOT_FOUND`, so the endpoint
 * cannot be asked whether a token ever existed.
 *
 * Bare family (ADR 0001): the answer is a `text/calendar` body, never JSON.
 *
 * The segment is a feed, not a file name: only `<token>.ics` is ever answered,
 * and `.ics` is on neither the Nginx Proxy Manager nor the Cloudflare cache
 * list (`middleware/assetPathGuard.ts`), so no extension-keyed cache keeps it.
 */
const router = Router();

/** `private`: a CDN or proxy must not keep one person's calendar for another. */
const CACHE_CONTROL = "private, max-age=300";

const notFound = () => new AppError("Not found", 404, "CALENDAR_FEED_NOT_FOUND");

router.get(
  "/:feed",
  calendarFeedReadLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Not indexed, and no Referer carrying the URL anywhere — on every answer.
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      const token = tokenOfFeedPath(req.params.feed);
      const userId = token ? await resolveFeedOwner(token) : null;
      if (!userId) {
        next(notFound());
        return;
      }
      const body = await buildFeed(userId, await getPublicBaseUrl(req));
      res.setHeader("Cache-Control", CACHE_CONTROL);
      res.setHeader("Content-Disposition", 'inline; filename="travstats.ics"');
      res.type("text/calendar; charset=utf-8");
      res.send(body);
    } catch (error) {
      // A fault of ours is logged in full and answered like a missing feed: a
      // calendar app shows "could not load" either way, and the holder of a
      // guessed URL learns nothing from a 500.
      logger.error({
        operation: "calendar_feed_failed",
        error: { message: error instanceof Error ? error.message : String(error) },
      });
      next(notFound());
    }
  }
);

export default router;
