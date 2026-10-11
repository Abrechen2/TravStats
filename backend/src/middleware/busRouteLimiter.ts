import rateLimit from "express-rate-limit";
import { RATE_LIMITS } from "../config/constants";
import { patAwareMax, userOrIpKey } from "./rateLimit";

/**
 * Bus road routing on existing rides ("route again", "route all"): every
 * request may spend the instance's routing quota, which belongs to the whole
 * instance. Its own bucket and message; kept out of `rateLimit.ts`, which sits
 * at the file-size limit.
 */
export const busRouteLimiter = rateLimit({
  windowMs: RATE_LIMITS.FLIGHT_CREATION_WINDOW_MS,
  max: patAwareMax(RATE_LIMITS.BUS_ROUTE_MAX),
  message: "Too many routing requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
