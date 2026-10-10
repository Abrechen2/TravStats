import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Public share links (forgejo#281). Its own file because `rateLimit.ts` sits
 * at the 800-line limit. Every key masks addresses through `ipKeyGenerator`
 * (/56 for IPv6), as express-rate-limit 8 demands (`rateLimit.ipv6.test.ts`).
 *
 * A limited request answers 429, not the uniform 404: it is given for any
 * token, live or not, so it says "slow down" and nothing about the link.
 */

const ipKey = (prefix: string) => (req: Request) =>
  `${prefix}:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`;

const limited = { error: "Too many requests, please try again later", code: "RATE_LIMITED" };

/**
 * Resolving a link, per address: 30 a minute. A flight page polls once a
 * minute; a family of five on one home connection is ten. Guessing a 256-bit
 * token is hopeless at any rate — this bounds scraping and load.
 */
export const shareLinkViewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: limited,
  keyGenerator: ipKey("share-view"),
});

/** Photos, per address: 60 a minute — twelve photos, a few reloads. */
export const shareLinkPhotoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: limited,
  keyGenerator: ipKey("share-photo"),
});

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
