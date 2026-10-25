import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";

import type { ApiErrorCode } from "./errorHandler";
import { userOrIpKey } from "./rateLimit";

/**
 * Per account: building a trip's route snapshot (`PUT /trips/:id/share-snapshot`)
 * reads up to 200 000 TravTrack points under an advisory lock inside a 60 s
 * transaction — the global limiter alone let one account hold that lock in a
 * loop (Codex review). A person shares or refreshes a route a few times; ten
 * builds in ten minutes is room for that and no more.
 *
 * Keyed on the ACCOUNT (`shareSnapshotBuildKey`), not on `userOrIpKey` alone:
 * that one gives every PAT a bucket of its own (`pat:<tokenId>`), so an
 * account with several tokens would hold several times the budget for the
 * same lock. The shared demo account and an unauthenticated request keep
 * `userOrIpKey`'s per-address buckets (masked through `ipKeyGenerator`).
 * Not PAT-multiplied: a token does not make the build any cheaper. Refuses before the transaction opens, with
 * a code the page names in DE and EN and the wait in seconds.
 */
export const SHARE_SNAPSHOT_BUILD_WINDOW_MS = 10 * 60 * 1000;
export const SHARE_SNAPSHOT_BUILD_MAX = 10;

/** One bucket per account, whichever session or token asks; the demo and the anonymous per address. */
export const shareSnapshotBuildKey = (req: Request): string => {
  const r = req as { userId?: string; isSharedDemo?: boolean };
  return r.userId && !r.isSharedDemo ? `user:${r.userId}` : userOrIpKey(req);
};

export const shareSnapshotBuildLimiter = rateLimit({
  windowMs: SHARE_SNAPSHOT_BUILD_WINDOW_MS,
  max: SHARE_SNAPSHOT_BUILD_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: shareSnapshotBuildKey,
  handler: (req: Request, res: Response) => {
    const resetAt = (req as { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
    const retryAfterSeconds = resetAt
      ? Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))
      : undefined;
    res.status(429).json({
      error: "Too many route builds, please try again later",
      code: "TRAVTRACK_ROUTE_BUILD_RATE_LIMITED" satisfies ApiErrorCode,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    });
  },
});
