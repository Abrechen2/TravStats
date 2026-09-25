import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { statsLimiter } from "../../middleware/rateLimit";
import { visitDateSuggestionsFor } from "../../services/places/visitDateSuggestions";

/**
 * `GET /places/:id/visit-date-suggestions` — dates the add-visit form can
 * offer for one of the caller's places (see the service for the rules).
 *
 * Own file on the places prefix, like `visitPhotos.ts`, and mounted before
 * `places.ts`; its path carries a segment more than any handler there. Shares
 * the stats bucket like the other entry-suggestion endpoints: three distance
 * scans over the logbook, asked once per opened form, not per keystroke.
 */
const router = Router();
router.use(authenticate);

export const visitDateSuggestionsParamsSchema = z.object({ id: z.string().uuid() });
export const visitDateSuggestionsQuerySchema = z.object({
  tripId: z.string().uuid().optional(),
});

router.get(
  "/:id/visit-date-suggestions",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = visitDateSuggestionsParamsSchema.safeParse(req.params);
      if (!params.success) throw new AppError("Invalid place id", 400);
      const query = visitDateSuggestionsQuerySchema.safeParse(req.query);
      if (!query.success) throw new AppError(query.error.message, 400);

      const suggestions = await visitDateSuggestionsFor(
        req.userId!,
        params.data.id,
        query.data.tripId ?? null
      );
      if (suggestions === null) throw new AppError("Place not found", 404);
      res.json({ success: true, data: { suggestions } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
