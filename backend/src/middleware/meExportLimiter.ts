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
  // A gateway hiccup (the web client retries GETs) must not burn the allowance.
  skipFailedRequests: true,
  keyGenerator: userOrIpKey,
});

/**
 * Starting an account archive export or import (forgejo#433): each one reads or
 * writes the whole account with every file, so a few per hour per account.
 */
export const accountArchiveLimiter = rateLimit({
  windowMs: RATE_LIMITS.ACCOUNT_ARCHIVE_WINDOW_MS,
  max: RATE_LIMITS.ACCOUNT_ARCHIVE_MAX,
  message: {
    error: "Too many account archive requests, please try again later",
    code: "rate_limited",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  keyGenerator: userOrIpKey,
});

/** The life book: one build reads the whole account (and fetches its photos). */
export const lifeBookLimiter = rateLimit({
  windowMs: RATE_LIMITS.LIFE_BOOK_WINDOW_MS,
  max: RATE_LIMITS.LIFE_BOOK_MAX,
  message: { error: "Too many life book requests, please try again later", code: "rate_limited" },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  keyGenerator: userOrIpKey,
});
