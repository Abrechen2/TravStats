import rateLimit from "express-rate-limit";

import { RATE_LIMITS } from "../config/constants";
import { patAwareMax, userOrIpKey } from "./rateLimit";

/**
 * Note creation (forgejo#137): rail's budget, its own bucket and message.
 *
 * Its own file because `rateLimit.ts` sits at the 800-line limit. The
 * Companion keeps notes offline and sends its outbox in one burst after a trip
 * without signal, so the budget is the per-request one of an import, not the
 * flight form's 20 an hour.
 */
export const noteCreationLimiter = rateLimit({
  windowMs: RATE_LIMITS.FLIGHT_CREATION_WINDOW_MS,
  max: patAwareMax(RATE_LIMITS.NOTE_CREATION_MAX),
  message: "Too many notes saved, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
