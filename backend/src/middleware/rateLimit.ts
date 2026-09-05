import { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { RATE_LIMITS } from '../config/constants';

/**
 * Rate-limit bucket key.
 *
 *   PAT requests  → "pat:<tokenId>"   — per-token bucket, isolated from
 *                                      the same user's browser session
 *                                      (an aggressive AI agent can't
 *                                      lock the user out of the UI)
 *   Cookie auth   → "user:<userId>"   — per-user bucket, prevents IP-
 *                                      hopping bypass for the same
 *                                      authenticated user
 *   Anonymous     → "ip:<ip>"         — fallback for unauthenticated
 *                                      endpoints (auth, password reset)
 */
const userOrIpKey = (req: Request): string => {
  const r = req as { userId?: string; apiToken?: { id: string } };
  if (r.apiToken) return `pat:${r.apiToken.id}`;
  if (r.userId) return `user:${r.userId}`;
  return `ip:${req.ip ?? 'unknown'}`;
};

/**
 * PAT requests get a higher quota than browser sessions or anonymous IPs.
 * Bulk-import / AI-agent flows legitimately need to make many writes
 * back-to-back; the user already had to mint a write-scoped PAT (one-time
 * deliberate action) so we trust them more than a generic anon IP.
 *
 * Browser-session and anonymous limits stay at the configured `baseMax`.
 * Multiplier of 10 is conservative — a 200-flight xlsx import via
 * `/flights/batch` (10 batches of 20) needs 10 batch requests; the
 * default 50/h is plenty even at 1×, but 500/h leaves headroom for
 * concurrent agent users on the same PAT pool.
 */
const PAT_MULTIPLIER = 10;
const patAwareMax = (baseMax: number) => (req: Request): number => {
  const r = req as { apiToken?: { id: string } };
  return r.apiToken ? baseMax * PAT_MULTIPLIER : baseMax;
};

/**
 * Rate limiter for public airport search endpoints. Two layers stacked:
 *
 *   1. Sustained ceiling: 100/15min (anon) — bounds total daily throughput.
 *   2. Burst ceiling:     30/min  (anon)   — bounds the per-second burst
 *      a scraper could otherwise use to enumerate the airport table in a
 *      handful of seconds before the 15-min window kicks in.
 *
 * `/airports/search` is intentionally unauthenticated so the autocomplete
 * works during signup before a user has credentials — the OurAirports
 * dataset it surfaces is already public, so there is no secrecy boundary
 * to defend, but limiting the rate keeps the endpoint from becoming a
 * cheap DB-pressure or scraping pivot.
 *
 * PAT-authenticated callers (autocomplete in agent flows) get the
 * standard PAT_MULTIPLIER on both buckets.
 */
export const airportSearchLimiter = rateLimit({
  windowMs: RATE_LIMITS.AIRPORT_SEARCH_WINDOW_MS,
  max: patAwareMax(RATE_LIMITS.AIRPORT_SEARCH_MAX),
  message: 'Too many airport search requests, please try again later',
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  keyGenerator: userOrIpKey,
});

export const airportSearchBurstLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: patAwareMax(30),
  message: 'Too many airport search requests in a short burst — slow down',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Per-user/IP limit for the external port geocoder (`/ports/geocode`).
 *
 * The geocoder proxies to OpenStreetMap Nominatim, which the service throttles
 * GLOBALLY to ≤1 req/s to honour their usage policy. Without a per-caller cap,
 * a single spammy client could monopolise that global throttle and starve the
 * geocoder for everyone. 30/min per caller is ample for debounced typeahead
 * (it only fires when the local catalog has no match) while bounding abuse.
 */
export const portGeocodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: patAwareMax(30),
  message: 'Too many port lookups in a short time — please slow down',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Per-user/IP limit for the Photon place-search proxy (`/geo/search`).
 *
 * Photon (komoot's public instance, or a self-hosted one) has no documented
 * hard rate limit the way Nominatim's usage policy does, but it is still a
 * shared public resource sitting behind search-as-you-type — a spammy client
 * could burn through it fast enough to get the instance's IP throttled or
 * banned upstream. Mirrors `portGeocodeLimiter`'s shape (same per-caller
 * keying + PAT-aware multiplier, same 30/min window) since the usage
 * pattern — debounced typeahead — is identical.
 */
export const photonSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: patAwareMax(30),
  message: 'Too many place searches in a short time — please slow down',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Per-user/IP limit for the FX preview proxy (`/lodging/fx-preview`).
 *
 * The route proxies to the free public Frankfurter/ECB API so the frontend
 * can show a live rate preview without the app's CSP blocking a direct
 * browser call. `fx.convertToBase` caches per (from, to, date), so repeated
 * identical queries are free — but a caller can simply vary `date` to force
 * unlimited uncached outbound calls, risking the instance's IP getting
 * banned from the free upstream. Mirrors `portGeocodeLimiter`'s shape (same
 * per-caller keying + PAT-aware multiplier, comparable 30/min window).
 */
export const fxPreviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: patAwareMax(30),
  message: 'Too many FX preview requests in a short time — please slow down',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Per-caller limit for BULK IMPORT endpoints. Named for its first consumer,
 * but it is the shared bucket for every import surface — `lodgingImport.ts`,
 * `importBatches.ts` and `import.ts` (the flight CSV routes) all mount it —
 * because they cost the same kind of thing: one request chews through up to a
 * thousand rows instead of touching one.
 *
 * What each consumer spends it on: `/lodging-import/suggest-mapping` calls an
 * LLM; `/lodging-import/preview` and `/commit` do real DB scans (up to
 * `MAX_LODGING_IMPORT_ROWS` rows) and `/commit` kicks off a background
 * Nominatim geocode backfill — whose usage policy would get the instance's IP
 * banned if abused; `/import/parse` lexes a 2 MiB CSV blob; `/import/preview`
 * enriches up to `MAX_PREVIEW_ROWS` (1000) rows with airport and timezone
 * lookups apiece.
 *
 * Mirrors `fxPreviewLimiter` / `portGeocodeLimiter`'s shape (per-caller keying
 * + PAT-aware multiplier), with a 15-minute window since a real import run is
 * a batch operation, not a typeahead. 60 covers the click-heavy loop a real
 * import is (parse → preview → adjust the mapping → preview again → commit)
 * several times over; a PAT-driven agent gets 600.
 *
 * MOUNT IT AFTER `authenticate`. `userOrIpKey` reads `req.userId`, so a
 * limiter placed above the auth middleware silently degrades to per-IP —
 * which on a LAN deployment behind a reverse proxy is one bucket for the
 * whole household.
 */
export const lodgingImportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: patAwareMax(60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many import requests, please try again later' },
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for flight creation
 * Allows 20 flight creations per hour per IP
 */
export const flightCreationLimiter = rateLimit({
  windowMs: RATE_LIMITS.FLIGHT_CREATION_WINDOW_MS,
  max: patAwareMax(RATE_LIMITS.FLIGHT_CREATION_MAX),
  message: 'Too many flights created, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for successful requests (only count failed/repeated attempts)
  skipSuccessfulRequests: false,
  keyGenerator: userOrIpKey,
});

/**
 * General API rate limiter
 * Allows 1000 requests per hour per IP
 */
export const generalLimiter = rateLimit({
  windowMs: RATE_LIMITS.GENERAL_WINDOW_MS,
  max: RATE_LIMITS.GENERAL_MAX_REQUESTS,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for authentication endpoints (login, register)
 * Protects against brute-force attacks and mass registration
 * Allows 10 attempts per 15 minutes per IP
 */
export const authLimiter = rateLimit({
  windowMs: RATE_LIMITS.AUTH_WINDOW_MS,
  max: RATE_LIMITS.AUTH_MAX_ATTEMPTS,
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  // Bypass in dev/test envs so Playwright e2e suites that loop through
  // login don't trip the 10/15min ceiling. Production unaffected — the
  // bypass requires NODE_ENV to be explicitly 'development' or 'test',
  // which the Docker image never sets.
  skip: () =>
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test',
  // All attempts count — skipSuccessfulRequests was removed to prevent brute-force bypass
});

/**
 * Rate limiter for flight lookup API endpoints
 * Protects external API keys from abuse (AirLabs, OpenSky)
 * Allows 30 lookups per 15 minutes per user.
 *
 * Per USER, not per address: the route sits behind `authenticate`, and a
 * household — or every user behind one reverse proxy — shares one address.
 * Until 2026-09-04 this bucket had no key generator, so one person's lookups
 * blocked everyone else on the same connection (forgejo#68).
 */
export const flightLookupLimiter = rateLimit({
  windowMs: RATE_LIMITS.FLIGHT_LOOKUP_WINDOW_MS,
  max: RATE_LIMITS.FLIGHT_LOOKUP_MAX,
  message: 'Too many flight lookup requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for analytics events
 * Protects against DoS attacks via large payloads
 * Allows 100 requests per 15 minutes per user (behind `authenticate`;
 * see flightLookupLimiter for why the key is the user, not the address).
 */
export const analyticsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many analytics requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for backup restore operations
 * Prevents accidental data loss through rapid restores
 * Allows 3 restores per hour per IP
 */
export const backupRestoreLimiter = rateLimit({
  windowMs: RATE_LIMITS.BACKUP_RESTORE_WINDOW_MS,
  max: RATE_LIMITS.BACKUP_RESTORE_MAX,
  message: 'Too many restore operations, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for OCR routes — boarding passes and whole documents.
 *
 * 20 parses per 15 minutes per USER, not per IP. It was per IP until
 * 2026-09-01, alone among the limiters in this file, which every sibling keys
 * with `userOrIpKey`. On a self-hosted instance behind a reverse proxy or
 * Cloudflare that made one shared budget for everybody: a single user
 * photographing a stack of receipts locked the others out of the most
 * expensive endpoint in the app. Nothing here suggests that was a decision, and
 * `/parse-image` made it matter for hotel and cruise users too.
 */
export const boardingPassParseLimiter = rateLimit({
  windowMs: RATE_LIMITS.BOARDING_PASS_PARSE_WINDOW_MS,
  max: RATE_LIMITS.BOARDING_PASS_PARSE_MAX,
  message: 'Too many boarding pass parse requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for email parsing (triggers expensive LLM operations)
 * Allows 10 parses per 15 minutes per IP
 */
export const emailParseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many parse requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for stats calculation endpoints (expensive DB aggregations)
 * Allows 30 requests per minute per IP
 */
export const statsLimiter = rateLimit({
  windowMs: RATE_LIMITS.STATS_WINDOW_MS,
  max: RATE_LIMITS.STATS_MAX_REQUESTS,
  message: 'Too many stats requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for admin export endpoint (loads entire database)
 * Allows 5 exports per hour per IP
 */
export const adminExportLimiter = rateLimit({
  windowMs: RATE_LIMITS.ADMIN_EXPORT_WINDOW_MS,
  max: RATE_LIMITS.ADMIN_EXPORT_MAX,
  message: 'Too many export requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for CATALOG RESEED / RESYNC endpoints — the rare operational
 * refreshes of instance-global data from an external source. Reseeding upserts
 * ~18k rows from OurAirports; the airline-logo re-sync and the parser-template
 * sync (`templateStatus.ts`) each fan out to a third-party host. Without a cap
 * a malicious admin PAT could DoS Postgres by spamming reseeds across process
 * restarts, and any authenticated user could burn the instance's GitHub raw
 * quota. 3/h is generous for legitimate operational use (initial seed, after
 * fixing a bad CSV, pulling a just-published template).
 *
 * Named `admin` for its first consumers; the template sync is not
 * admin-gated, which is a separate question from how often it may run.
 */
export const adminReseedLimiter = rateLimit({
  windowMs: RATE_LIMITS.ADMIN_RESEED_WINDOW_MS,
  max: RATE_LIMITS.ADMIN_RESEED_MAX,
  message: 'Too many reseed requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for PDF parse endpoint
 * Allows 20 requests per 15 minutes per user. The comment always said "per
 * user"; the key generator that makes it true arrived on 2026-09-04
 * (forgejo#68).
 */
export const pdfParseLimiter = rateLimit({
  windowMs: RATE_LIMITS.PDF_PARSE_WINDOW_MS,
  max: RATE_LIMITS.PDF_PARSE_MAX,
  message: 'Too many PDF parse requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for batch flight creation
 * 1 batch = up to 20 flights. 50 batches/hour = max ~1000 flights/hour.
 * Generous limit to support bulk email import workflows.
 */
export const batchCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: patAwareMax(50), // 50/h cookie, 500/h with PAT (bulk imports)
  message: 'Too many batch requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for user-supplied FILE uploads. Named for its first consumer
 * (receipts), but it is the shared bucket for every multipart route that
 * writes bytes to the data volume: receipts (`uploads.ts`), parser training
 * samples (`training.ts`, 20 MB each and base64'd into a jsonb column), trip
 * photos and place-visit photos (`trips.ts`, `places/visitPhotos.ts`, 15 MB ×
 * 20 per request). One bucket is right here — they all exhaust the SAME disk,
 * so a per-surface budget would just be three ways to fill it.
 *
 * 30 requests/hour, not 30 files: a photo route accepts 20 files per request,
 * so this still allows ~600 photos an hour — generous for a real gallery
 * upload, bounded for a script.
 *
 * Mount it BEFORE the multer middleware on each route, or a 429'd request
 * still writes its bytes to disk first, which defeats the point.
 */
export const uploadReceiptLimiter = rateLimit({
  windowMs: RATE_LIMITS.UPLOAD_RECEIPT_WINDOW_MS,
  max: RATE_LIMITS.UPLOAD_RECEIPT_MAX,
  message: 'Too many file uploads, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  // Per-user, like every other limiter in this file. It was per-IP until the
  // upload surfaces above started sharing it: on a LAN deployment behind a
  // reverse proxy that is one 30/h bucket for every user in the house.
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for profile picture uploads
 * Prevents disk exhaustion through repeated uploads
 * Allows 20 uploads per hour per user
 */
export const uploadProfilePictureLimiter = rateLimit({
  windowMs: RATE_LIMITS.UPLOAD_PROFILE_PICTURE_WINDOW_MS,
  max: RATE_LIMITS.UPLOAD_PROFILE_PICTURE_MAX,
  message: 'Too many profile picture uploads, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for settings endpoints
 * Prevents enumeration and brute-force of settings values
 * Allows 60 requests per 15 minutes per IP
 */
export const settingsLimiter = rateLimit({
  windowMs: RATE_LIMITS.SETTINGS_WINDOW_MS,
  max: RATE_LIMITS.SETTINGS_MAX_REQUESTS,
  message: 'Too many settings requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for password reset endpoints
 * Prevents brute-force on reset token endpoints
 * Allows 5 attempts per 15 minutes per IP
 */
export const passwordResetLimiter = rateLimit({
  windowMs: RATE_LIMITS.PASSWORD_RESET_WINDOW_MS,
  max: RATE_LIMITS.PASSWORD_RESET_MAX,
  message: 'Too many password reset attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for the public device-pairing claim endpoint.
 *
 * `/pairing/claim` is unauthenticated by design (the mobile app has no
 * credentials yet — it's exchanging a one-time code for a token), so it's
 * keyed by IP. The code itself is a 128-bit secret with a 10-minute TTL, but a
 * tight per-IP cap blocks brute-force enumeration of the code space. 10/15min
 * is ample for a human pairing a handful of devices.
 */
export const pairingClaimLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many pairing attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for diagnostic bundle export.
 * Generous enough for a user iterating on a bug report, tight enough that
 * the endpoint can't be used to scrape logs.
 */
export const diagnosticExportLimiter = rateLimit({
  windowMs: RATE_LIMITS.DIAGNOSTIC_EXPORT_WINDOW_MS,
  max: RATE_LIMITS.DIAGNOSTIC_EXPORT_MAX,
  message: 'Too many diagnostic export requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for the Immich image proxy. A single gallery render can
 * request hundreds of tiles (thumbnails for every asset in a linked album),
 * so this budget is deliberately generous — it exists to bound abuse, not
 * normal browsing.
 */
export const immichProxyLimiter = rateLimit({
  windowMs: RATE_LIMITS.IMMICH_PROXY_WINDOW_MS,
  max: patAwareMax(RATE_LIMITS.IMMICH_PROXY_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for the rare-and-heavy Immich operations: album import
 * (downloads every asset in an album to local storage) and the photo-journey
 * scan (`photoJourneys.ts`), which walks the user's whole library over a
 * ten-year default window and then reverse-geocodes every surviving cluster
 * against Nominatim — the same upstream whose usage policy gets an instance's
 * IP banned, which is why `portGeocodeLimiter` exists.
 *
 * One bucket for both is deliberate: they are the two ways a single request
 * turns into an unbounded amount of work against someone else's server, and a
 * user has no reason to run them concurrently. 20 per 15 minutes is far more
 * than the handful of deliberate clicks either is worth.
 */
export const immichImportLimiter = rateLimit({
  windowMs: RATE_LIMITS.IMMICH_IMPORT_WINDOW_MS,
  max: patAwareMax(RATE_LIMITS.IMMICH_IMPORT_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for the airline-logo proxy. Cheap after the first fetch
 * (disk cache in logoCache.ts), but each cold miss costs an upstream
 * request against the 20k/month logostream budget — the cap bounds how
 * fast a single caller can burn through that budget on unseen codes.
 * Allows 600 requests per 15 minutes per user/IP.
 */
export const airlineLogoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: 'Too many airline logo requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

/**
 * Rate limiter for the country-flag endpoints. Every answer is a local file
 * read served from an in-process cache, so the cap is not protecting a
 * budget — it bounds how hard one caller can hammer a route that reads
 * disk on a cold key. Allows 600 requests per 15 minutes per user/IP.
 */
export const countryFlagLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: 'Too many country flag requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
