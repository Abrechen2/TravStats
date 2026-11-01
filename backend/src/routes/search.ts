import { Router, type NextFunction, type Response } from "express";

import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { globalSearchLimiter } from "../middleware/searchRateLimit";
import { searchQuerySchema } from "../schemas/search";
import { globalSearch } from "../services/search/globalSearch";

/**
 * `GET /search` — one query across every domain the account may see (flights,
 * cruises, stays, places, rail/bus/ferry rides, rentals, roadtrips, tours,
 * trips). Serves the web header's search field and the Companion.
 * Owner-scoped, enabled-domain-scoped, bounded: see `services/search`.
 */
const router = Router();
router.use(authenticate);

router.get(
  "/",
  globalSearchLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success)
        throw new AppError(parsed.error.issues[0]?.message ?? "Invalid query", 400);
      const { q, limit, domains } = parsed.data;
      const data = await globalSearch(req.userId!, q, limit, domains);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
