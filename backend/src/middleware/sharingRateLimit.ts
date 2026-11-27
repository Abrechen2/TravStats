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

/**
 * Linking existing copies, per user and per server side (UAT 2026-11-27): the bulk link compares
 * and links one trip pair per request, so a person with sixty shared trips sends about 120 calls in
 * one run. Three hundred an hour carries that with room for a retry, and still bounds a loop that
 * would make another server compare trips without end. A refused call answers 429 with
 * `Retry-After`; the bulk run waits and resumes where it stopped.
 */
const LINK_WINDOW_MS = 60 * 60 * 1000;
const LINK_MAX_PER_WINDOW = 300;

const linkLimiter = (scope: string) =>
  rateLimit({
    windowMs: LINK_WINDOW_MS,
    max: LINK_MAX_PER_WINDOW,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many link requests, please try again later", code: "RATE_LIMITED" },
    keyGenerator: (req: Request): string => {
      const userId = (req as { userId?: string }).userId;
      if (userId) return `${scope}:${userId}`;
      return `${scope}-ip:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`;
    },
  });

export const shareLinkLimiter = linkLimiter("share-link");
export const remoteShareLinkLimiter = linkLimiter("share-link-remote");
