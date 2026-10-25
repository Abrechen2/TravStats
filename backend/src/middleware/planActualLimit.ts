import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import type { ApiErrorCode } from "./errorHandler";
import { patAwareMax, skipInDevelopment, userOrIpKey } from "./rateLimit";

/**
 * Plan versus actual (`GET /trips/:tripId/plan/actual`, TravTrack plan L5):
 * one request can mean a full remote Dawarich read of the trip's window, so
 * the endpoint has its own per-account bucket on top of the read cache — 20 a
 * minute for a browser session, ten times that for a PAT. The web asks on
 * opening the section and on the user's refresh, so a person never meets it.
 *
 * Its own file because `rateLimit.ts` stands at the 800-line limit.
 */
export const PLAN_ACTUAL_PER_MINUTE = 20;

export const planActualLimiter = rateLimit({
  windowMs: 60_000,
  max: patAwareMax(PLAN_ACTUAL_PER_MINUTE),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  skip: skipInDevelopment,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: "Too many plan comparisons, please try again in a minute",
      code: "RATE_LIMITED" satisfies ApiErrorCode,
    });
  },
});
