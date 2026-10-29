import rateLimit from "express-rate-limit";

import { patAwareMax, userOrIpKey } from "./rateLimit";

/**
 * Rate limits of the Track area's further views (TravTrack plan T5.3). Keyed
 * by `userOrIpKey`, whose IPv6 masking express-rate-limit 8 checks.
 *
 *   - `travTrackViewLimiter` — range reads, the flight panel, stays and the
 *     calendar: a map paging a year asks a few dozen parts, so 120 a minute.
 *   - `travTrackPhotoSearchLimiter` — each window is one Immich search: 30 a minute.
 *   - `travTrackPointDeleteLimiter` — one point at a time from the inspector:
 *     60 a minute, so a script cannot replace a range delete by a stream of these.
 *   - `travTrackDiagnosticsLimiter` — the phone's diagnostics log uploads: 30 in
 *     15 minutes, a bucket of their own so a chatty log never eats the points'.
 */

const perMinute = (max: number) =>
  rateLimit({
    windowMs: 60_000,
    max: patAwareMax(max),
    keyGenerator: userOrIpKey,
    standardHeaders: true,
    legacyHeaders: false,
  });

export const travTrackViewLimiter = perMinute(120);
export const travTrackPhotoSearchLimiter = perMinute(30);
export const travTrackPointDeleteLimiter = perMinute(60);

export const travTrackDiagnosticsLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: patAwareMax(30),
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many diagnostics uploads, please try again later" },
});
