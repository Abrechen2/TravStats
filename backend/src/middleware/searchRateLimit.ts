import rateLimit from "express-rate-limit";

import { patAwareMax, userOrIpKey } from "./rateLimit";

/**
 * Per-user limit for the global search (`/search`). The header field fires one
 * request per settled keystroke and each fans out to up to eleven bounded
 * queries, so 120/min (four times the stats bucket) lets fast typing through
 * while a scripted loop still meets it.
 */
export const globalSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: patAwareMax(120),
  message: "Too many searches in a short time — please slow down",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
