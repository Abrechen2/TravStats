/**
 * The leaderboard's limiters (comparison rework 2026-10-16). In a file of their own because
 * `rateLimit.ts` sits one line under the 800-line limit; the key and the PAT quota come from
 * its helpers, so the IPv6 masking (`ipKeyGenerator` inside `userOrIpKey`) and the token
 * multiplier stay in one place.
 *
 * A read builds up to ~9 loaders per friend and pulls remote servers, so 60/min per user;
 * asking people, minting invitations and redeeming them is 30/h — enough for real use, too
 * few to probe usernames or burn codes.
 */
import rateLimit from "express-rate-limit";
import { patAwareMax, userOrIpKey } from "./rateLimit";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const READS_PER_MINUTE = 60;
const WRITES_PER_HOUR = 30;

export const comparisonReadLimiter = rateLimit({
  windowMs: MINUTE_MS,
  max: patAwareMax(READS_PER_MINUTE),
  message: "Too many comparison requests — please slow down",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

export const comparisonWriteLimiter = rateLimit({
  windowMs: HOUR_MS,
  max: patAwareMax(WRITES_PER_HOUR),
  message: "Too many comparison requests in an hour",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
