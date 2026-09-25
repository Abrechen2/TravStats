import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { statsLimiter } from "../middleware/rateLimit";
import {
  cruiseTripPhotos,
  flightTripPhotos,
  lodgingTripPhotos,
  railTripPhotos,
  type WindowPhoto,
} from "../services/photos/tripPhotoWindows";

/**
 * Read-only trip photographs on a stay, a flight, a cruise and a train ride
 * (package 9, item 4) — found by when and where they were taken, see the service.
 *
 * Mounted on `/api/v1`, so middleware is PER ROUTE: a `router.use` here would
 * run for every request that passes this router, public ones included. Each
 * route shares the stats bucket — one bounded scan of the caller's photos per
 * opened detail page.
 */
const router = Router();

const idParams = z.object({ id: z.string().uuid() });

type Finder = (userId: string, id: string) => Promise<WindowPhoto[] | null>;

function windowRoute(finder: Finder, notFound: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = idParams.safeParse(req.params);
      if (!params.success) throw new AppError("Invalid id", 400);
      const photos = await finder(req.userId!, params.data.id);
      if (photos === null) throw new AppError(notFound, 404);
      res.json({ success: true, data: { photos } });
    } catch (err) {
      next(err);
    }
  };
}

router.get(
  "/lodging/:id/trip-photos",
  authenticate,
  statsLimiter,
  windowRoute(lodgingTripPhotos, "Lodging not found")
);
router.get(
  "/flights/:id/trip-photos",
  authenticate,
  statsLimiter,
  windowRoute(flightTripPhotos, "Flight not found")
);
router.get(
  "/cruises/:id/trip-photos",
  authenticate,
  statsLimiter,
  windowRoute(cruiseTripPhotos, "Cruise not found")
);
// Answers whatever the rail beta switch says, like every rail endpoint; the
// switch hides the detail page that asks.
router.get(
  "/rail/:id/trip-photos",
  authenticate,
  statsLimiter,
  windowRoute(railTripPhotos, "Rail journey not found")
);

export default router;
