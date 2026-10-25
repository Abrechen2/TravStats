import type { Request } from "express";
import rateLimit from "express-rate-limit";

import { userOrIpKey } from "./rateLimit";

/**
 * File imports into TravTrack (plan E8): 30 per 15 minutes per ACCOUNT. Each
 * request holds its file — up to 25 MB — in memory until it is read, so the
 * bucket bounds memory as much as work, and is therefore stricter than the
 * other import limiters (Codex review of E8):
 *
 *   - keyed on the account, not the token: `userOrIpKey` keys a PAT by its id,
 *     so every further token would have been a further bucket;
 *   - a fixed number, not `patAwareMax` (×10 for a PAT);
 *   - built with `rateLimit`, not `importLimit`: import mode lifts the
 *     per-row limits of a bulk import, not this one.
 *
 * The shared demo and an anonymous caller keep `userOrIpKey`'s answer (by
 * address). Mount AFTER `authenticate`.
 */
export const TRAVTRACK_IMPORTS_PER_WINDOW = 30;

export const travTrackImportKey = (req: Request): string => {
  const r = req as { userId?: string; isSharedDemo?: boolean };
  return r.userId && !r.isSharedDemo ? `user:${r.userId}` : userOrIpKey(req);
};

export const travTrackImportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: TRAVTRACK_IMPORTS_PER_WINDOW,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many TravTrack imports, please try again later", code: "RATE_LIMITED" },
  keyGenerator: travTrackImportKey,
});
