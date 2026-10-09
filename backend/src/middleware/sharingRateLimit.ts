import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Consent requests, per user: 30 an hour. A request answers whether a
 * username exists on this server, so an unbounded endpoint would be a user
 * directory for anyone with an account. Thirty is far above asking every
 * travel companion one has, far below enumerating anything.
 *
 * Its own file because `rateLimit.ts` sits at the 800-line limit. The key
 * masks addresses through `ipKeyGenerator`, as express-rate-limit 8 demands
 * (see `rateLimit.ipv6.test.ts`).
 */
export const shareConsentRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many consent requests, please try again later", code: "RATE_LIMITED" },
  keyGenerator: (req: Request): string => {
    const userId = (req as { userId?: string }).userId;
    if (userId) return `share-consent:${userId}`;
    return `share-consent-ip:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`;
  },
});
