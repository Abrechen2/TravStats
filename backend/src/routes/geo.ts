import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import {
  authenticate,
  requireWriteScope,
  AuthRequest,
} from "../middleware/auth";
import { photonSearchLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { searchPlacesDetailed } from "../services/geo/photon";
import { reverseGeocode } from "../services/geo/nominatim";

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

const searchQuerySchema = z.object({
  q: z.string().min(2).max(200),
  lang: z.string().length(2).optional(),
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
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const { q, lang } = parsed.data;

      // `degraded: true` = the geocoder itself failed (still HTTP 200 with
      // an empty list, so a flaky geocoder never breaks the form) — the UI
      // uses it to show "search unavailable" instead of "no results" (#263).
      const outcome = await searchPlacesDetailed(q, { lang });
      res.json({ success: true, data: outcome.results, degraded: outcome.degraded });
    } catch (err) {
      next(err);
    }
  },
);

const reverseQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

// Coordinates → address parts, for the map-pick modal: a picked pin can
// COMPLETE an address on every surface, not only via the lodging save path.
// Backed by Nominatim (one-shot lookups, not per-keystroke), which brings its
// own process-wide 1 req/s throttle + cache and never throws — a failed
// lookup answers `data: null`, exactly like a pin in open water.
router.get(
  "/reverse",
  photonSearchLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = reverseQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const { lat, lon } = parsed.data;

      const parts = await reverseGeocode(lat, lon);
      res.json({ success: true, data: parts });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
