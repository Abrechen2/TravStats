import rateLimit from "express-rate-limit";
import { patAwareMax, userOrIpKey } from "./rateLimit";

/** Separate from creating journeys: refreshing a line spends external requests. */
export const railRouteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: patAwareMax(60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: {
    success: false,
    error: "Too many routing requests; try again later",
    code: "RATE_LIMITED",
  },
});
