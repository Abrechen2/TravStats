import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { photonSearchLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { reversePlacesDetailed, searchPlacesDetailed } from "../services/geo/photon";
import { reverseGeocodeDetailed } from "../services/geo/nominatim";

/**
 * Same-origin geocoder proxy — mounted at /api/v1/geo. The browser's CSP
 * (`connect-src 'self'`, see `index.ts`) forbids fetching Photon/Nominatim
 * directly, so every geocoder call goes through a backend proxy like this
 * one (precedent: `GET /ports/geocode`, `GET /lodging/fx-preview`).
 */
const router = Router();
router.use(authenticate);
// Read-only endpoint; requireWriteScope's GET passthrough applies naturally
// (mirrors routes/ports.ts) — kept for consistency even though this router
// currently has no write routes.
router.use(requireWriteScope);

/**
 * A 400 a client can branch on: `VALIDATION_FAILED` plus the field the first
 * issue names (`lat`, `limit`, …). The prose stays zod's — it is for the log.
 */
function invalidQuery(error: z.ZodError): AppError {
  const field = error.issues[0]?.path.join(".") || undefined;
  return new AppError(error.message, 400, "VALIDATION_FAILED", field);
}

/**
 * Optional `lat`/`lon` pair for location bias (forgejo#209): both or neither.
 * A lone `lat` is refused rather than ignored — a client that sends half a
 * position has a bug, and silently searching worldwide would hide it.
 */
export const BIAS_PAIR_MESSAGE = "lat and lon must be given together";

const searchQuerySchema = z
  .object({
    q: z.string().min(2).max(200),
    lang: z.string().length(2).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lon: z.coerce.number().min(-180).max(180).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.lat === undefined) !== (value.lon === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: [value.lat === undefined ? "lat" : "lon"],
        message: BIAS_PAIR_MESSAGE,
      });
    }
  });

// Search-as-you-type against Photon (komoot) — Nominatim's usage policy
// forbids per-keystroke queries, which is why Photon (not Nominatim) backs
// this endpoint. See services/geo/photon.ts for the never-throws contract.
router.get(
  "/search",
  photonSearchLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) throw invalidQuery(parsed.error);
      const { q, lang, lat, lon } = parsed.data;

      // `degraded: true` = the geocoder itself failed (still HTTP 200 with
      // an empty list, so a flaky geocoder never breaks the form) — the UI
      // uses it to show "search unavailable" instead of "no results" (#263).
      const near = lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
      const outcome = await searchPlacesDetailed(q, { lang, ...(near ? { near } : {}) });
      res.json({ success: true, data: outcome.results, degraded: outcome.degraded });
    } catch (err) {
      next(err);
    }
  }
);

const reverseQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

// Coordinates → address parts, for the map-pick modal: a picked pin can
// COMPLETE an address on every surface, not only via the lodging save path.
// Backed by Nominatim (one-shot lookups, not per-keystroke), which brings its
// own process-wide 1 req/s throttle + cache and never throws. A pin in open
// water answers `data: null`; a FAILED lookup answers `data: null` with
// `degraded: true`, so the modal can tell the two apart.
router.get(
  "/reverse",
  photonSearchLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = reverseQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const { lat, lon } = parsed.data;

      const outcome = await reverseGeocodeDetailed(lat, lon);
      res.json({ success: true, data: outcome.parts, degraded: outcome.degraded });
    } catch (err) {
      next(err);
    }
  }
);

/** How many nearby places come back when the caller names no `limit` — the
 *  map-pick modal's POI list, which does not. */
export const REVERSE_PLACES_DEFAULT_LIMIT = 5;
/** The longest list a caller may ask for (the Companion shows up to 12). */
export const REVERSE_PLACES_MAX_LIMIT = 20;
/** The widest radius a caller may ask for, in km. Photon allows 5000; a
 *  "what is here" list over more than a walk is not one. */
export const REVERSE_PLACES_MAX_RADIUS_KM = 5;

const reversePlacesQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  lang: z.string().length(2).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(REVERSE_PLACES_MAX_LIMIT)
    .default(REVERSE_PLACES_DEFAULT_LIMIT),
  // Omitted = Photon's own default (1 km), i.e. exactly what this route did
  // before the parameter existed.
  radiusKm: z.coerce.number().positive().max(REVERSE_PLACES_MAX_RADIUS_KM).optional(),
});

// The NAMED places around a pin (Photon /reverse, limit > 1) — the map-pick
// modal's Google-Maps-like "what is here?" selection and the Companion's
// "Ort jetzt". Ordered by importance, then distance (forgejo#209), each hit
// carrying its `rank`. Same envelope as /search: `degraded: true` = the
// geocoder failed, still HTTP 200.
router.get(
  "/reverse-places",
  photonSearchLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = reversePlacesQuerySchema.safeParse(req.query);
      if (!parsed.success) throw invalidQuery(parsed.error);
      const { lat, lon, lang, limit, radiusKm } = parsed.data;

      const outcome = await reversePlacesDetailed(lat, lon, {
        lang,
        limit,
        ...(radiusKm !== undefined ? { radiusKm } : {}),
      });
      res.json({ success: true, data: outcome.results, degraded: outcome.degraded });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
