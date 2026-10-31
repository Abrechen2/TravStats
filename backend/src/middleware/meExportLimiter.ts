import rateLimit from "express-rate-limit";
import { RATE_LIMITS } from "../config/constants";
import { userOrIpKey } from "./rateLimit";

/**
 * Self-service account export (forgejo#391): one user's whole history is read
 * and serialised, so 3 per hour per user. Its own file because rateLimit.ts
 * sits at the 800-line limit.
 */
export const meExportLimiter = rateLimit({
  windowMs: RATE_LIMITS.ME_EXPORT_WINDOW_MS,
  max: RATE_LIMITS.ME_EXPORT_MAX,
  message: { error: "Too many export requests, please try again later", code: "rate_limited" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
