import rateLimit from "express-rate-limit";

import { patAwareMax, userOrIpKey } from "./rateLimit";

/**
 * Live position polling (forgejo#408 phase 2). Kept out of `rateLimit.ts`, which sits on its
 * frozen size. Answers are cached 60 s upstream, so 30 a minute is ample for a cockpit poll.
 */
export const flightLivePositionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: patAwareMax(30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many live position requests, please try again shortly" },
  keyGenerator: userOrIpKey,
});
