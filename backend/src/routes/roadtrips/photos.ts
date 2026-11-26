import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { statsLimiter } from "../../middleware/rateLimit";
import { loadRoadtripPhotos } from "../../services/roadtrip/roadtripPhotos";

const router = Router();
const idParams = z.object({ id: z.string().uuid() });

/**
 * GET /roadtrips/:id/photos — every photo that belongs to the roadtrip: the ones filed at
 * its stations, stays and visits, plus the trip's unfiled uploads that fit its days and
 * route. One bounded read per opened tab; the library (Immich / PhotoPrism) candidates of a
 * day come from the per-station suggestion route when that day is opened.
 */
router.get(
  "/roadtrips/:id/photos",
  authenticate,
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = idParams.safeParse(req.params);
      if (!params.success) throw new AppError("Invalid id", 400);
      const result = await loadRoadtripPhotos(req.userId!, params.data.id);
      if (!result) throw new AppError("Roadtrip not found", 404);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
