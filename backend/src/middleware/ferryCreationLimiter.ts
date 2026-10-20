import { importLimit } from "./importModeLimit";
import { RATE_LIMITS } from "../config/constants";
import { patAwareMax, userOrIpKey } from "./rateLimit";

export const ferryCreationLimiter = importLimit({
  windowMs: RATE_LIMITS.FLIGHT_CREATION_WINDOW_MS,
  max: patAwareMax(RATE_LIMITS.BUS_CREATION_MAX),
  message: "Too many ferry crossings saved, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
