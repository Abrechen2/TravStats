import { importLimit } from "./importModeLimit";
import { patAwareMax, userOrIpKey } from "./rateLimit";

/**
 * File imports into TravTrack (plan E8), per user: 30 per 15 minutes. Each
 * request holds its file — up to 25 MB — in memory until the job has parsed
 * it, so the bucket bounds memory as much as work. Mount AFTER `authenticate`
 * (`userOrIpKey` reads `req.userId`; it masks IPv6 through `ipKeyGenerator`).
 */
export const travTrackImportLimiter = importLimit({
  windowMs: 15 * 60 * 1000,
  max: patAwareMax(30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many TravTrack imports, please try again later" },
  keyGenerator: userOrIpKey,
});
