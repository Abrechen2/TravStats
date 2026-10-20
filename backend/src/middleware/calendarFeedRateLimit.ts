import type { Request, RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import { calendarTokenHash, looksLikeCalendarToken } from "../services/calendarFeed/token";
import { tokenOfFeedPath } from "../services/calendarFeed/feedPath";

/**
 * The calendar feed (forgejo#310). Its own file because `rateLimit.ts` sits at
 * the 800-line limit. Every address key goes through `ipKeyGenerator` (/56 for
 * IPv6), as express-rate-limit 8 demands (`rateLimit.ipv6.test.ts`).
 *
 * A limited request answers 429, not the uniform 404: it is given for any
 * token, live or not, so it says "slow down" and nothing about the feed.
 */

const limited = { error: "Too many requests, please try again later", code: "RATE_LIMITED" };

/**
 * The feed a request names, as a short hash — never the token itself, which
 * would then sit in the limiter's memory. Keyed on the FEED, not the address:
 * Google Calendar polls from a pool of addresses, and a user's phone, laptop
 * and Google account all read the same URL.
 */
const feedKey = (req: Request): string => {
  const token = tokenOfFeedPath(req.params.feed);
  return looksLikeCalendarToken(token)
    ? `cal-feed:${calendarTokenHash(token).slice(0, 32)}`
    : `cal-feed-none:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`;
};

/**
 * 120 reads an hour per feed. A calendar app polls hourly at most when asked
 * to (`REFRESH-INTERVAL`); a handful of devices and a "refresh now" or two
 * stay far below that, a script hammering one URL does not.
 */
const feedReadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: limited,
  keyGenerator: feedKey,
});

/**
 * The scraping bound the per-feed key gives up: an address may ask for at most
 * 30 feeds a minute that do not resolve. Only failed answers count, so the
 * subscribers of a live feed never use it up.
 */
const feedMissLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: limited,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => `cal-miss:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`,
});

/** Both limiters as one middleware; the second runs only if the first lets the request through. */
export const calendarFeedReadLimiter: RequestHandler = (req, res, next) =>
  feedReadLimiter(req, res, (err?: unknown) => (err ? next(err) : feedMissLimiter(req, res, next)));

/** Issuing a new URL, per user: 20 an hour — far above any honest regenerating. */
export const calendarFeedIssueLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: limited,
  keyGenerator: (req: Request): string => {
    const userId = (req as { userId?: string }).userId;
    if (userId) return `cal-issue:${userId}`;
    return `cal-issue-ip:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`;
  },
});
