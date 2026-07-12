import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import {
  authenticate,
  requireWriteScope,
  AuthRequest,
} from "../middleware/auth";
import { photonSearchLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import { searchPlaces } from "../services/geo/photon";

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

      const results = await searchPlaces(q, { lang });
      res.json({ success: true, data: results });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
