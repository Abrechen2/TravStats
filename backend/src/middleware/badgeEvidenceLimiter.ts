import rateLimit from "express-rate-limit";
import { RATE_LIMITS } from "../config/constants";
import { skipInDevelopment, userOrIpKey } from "./rateLimit";

/**
 * Badge proofs (`/evidence/metric/badge…`, forgejo#265) fold a badge's rows
 * over and over to find the entries its progress stands on. Each request is
 * bounded by the witness budget (`services/evidence/badges/witness.ts`); this
 * bounds how often one user may ask, per user (`userOrIpKey`), on top of
 * `statsLimiter`.
 */
export const badgeEvidenceLimiter = rateLimit({
  windowMs: RATE_LIMITS.BADGE_EVIDENCE_WINDOW_MS,
  max: RATE_LIMITS.BADGE_EVIDENCE_MAX_REQUESTS,
  skip: skipInDevelopment,
  message: "Too many badge evidence requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
