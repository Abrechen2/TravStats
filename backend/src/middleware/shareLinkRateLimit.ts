import type { Request, RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import { looksLikeShareToken, shareTokenHash } from "../services/shareLinks/token";

/**
 * Public share links (forgejo#281). Its own file because `rateLimit.ts` sits
 * at the 800-line limit. Every key masks addresses through `ipKeyGenerator`
 * (/56 for IPv6), as express-rate-limit 8 demands (`rateLimit.ipv6.test.ts`).
 *
 * A limited request answers 429, not the uniform 404: it is given for any
 * token, live or not, so it says "slow down" and nothing about the link.
 */

const limited = { error: "Too many requests, please try again later", code: "RATE_LIMITED" };

/**
 * The link a request names, as a short hash — never the token itself, which
 * would then sit in the limiter's memory. Anything not token-shaped is one
 * bucket per address, the same as before.
 */
const linkOf = (req: Request): string => {
  const token = (req.body as { token?: unknown } | undefined)?.token;
  return looksLikeShareToken(token) ? shareTokenHash(token).slice(0, 32) : "none";
};

/**
 * Keyed on link AND address. Keyed on the address alone, every viewer behind
 * the instance's reverse proxy (or one home connection) drew on ONE bucket,
 * so a single busy flight page closed every other link of the instance.
 */
const linkAndIpKey = (prefix: string) => (req: Request) =>
  `${prefix}:${linkOf(req)}:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`;

/** Two limiters as one middleware; the second runs only if the first lets the request through. */
const both =
  (first: RequestHandler, second: RequestHandler): RequestHandler =>
  (req, res, next) =>
    first(req, res, (err?: unknown) => (err ? next(err) : second(req, res, next)));

/**
 * The abuse bound the per-link key gives up: an address may ask for at most
 * 30 links a minute that do not resolve (only failed answers count, so the
 * viewers of a live link never use it). A random token gets a fresh per-link
 * bucket; this is what still stops a scraper walking through them.
 */
const shareLinkMissLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: limited,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => `share-miss:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`,
});

/**
 * Resolving a link, per link and address: 30 a minute. A flight page polls
 * once a minute; a family of five on one home connection is ten. Guessing a
 * 256-bit token is hopeless at any rate — the miss limiter bounds scraping.
 */
export const shareLinkViewLimiter: RequestHandler = both(
  rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: limited,
    keyGenerator: linkAndIpKey("share-view"),
  }),
  shareLinkMissLimiter
);

/** Photos, per link and address: 60 a minute — twelve photos, a few reloads. */
export const shareLinkPhotoLimiter: RequestHandler = both(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: limited,
    keyGenerator: linkAndIpKey("share-photo"),
  }),
  shareLinkMissLimiter
);

/** Creating links, per user: 30 an hour — far above sharing, far below spraying. */
export const shareLinkCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: limited,
  keyGenerator: (req: Request): string => {
    const userId = (req as { userId?: string }).userId;
    if (userId) return `share-create:${userId}`;
    return `share-create-ip:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`;
  },
});
