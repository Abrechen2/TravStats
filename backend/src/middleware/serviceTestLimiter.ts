import rateLimit from "express-rate-limit";
import { RATE_LIMITS } from "../config/constants";
import { userOrIpKey } from "./rateLimit";

/**
 * "Testen" on a service card: each press can be a real provider request, so it
 * is bounded per account (keyed through `userOrIpKey`, which masks IPv6).
 */
export const serviceTestLimiter = rateLimit({
  windowMs: RATE_LIMITS.SERVICE_TEST_WINDOW_MS,
  max: RATE_LIMITS.SERVICE_TEST_MAX_REQUESTS,
  message: "Too many connection tests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
