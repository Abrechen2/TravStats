import { Router, type NextFunction, type Response } from "express";
import rateLimit from "express-rate-limit";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { patAwareMax, userOrIpKey } from "../../middleware/rateLimit";
import { AppError } from "../../middleware/errorHandler";
import {
  revokeTripRoute,
  sharedTripRoutes,
  shareTripRoute,
  tripRouteSnapshot,
} from "../../services/travtrack/shareSnapshot";
import logger from "../../utils/logger";
import { travTrackTier } from "./gate";

/**
 * A shared trip's route (TravTrack plan T7). The owner shares the trip's
 * TravTrack line as a geometry-only snapshot (`PUT`), sees what is shared
 * (`GET`) and revokes it for every recipient at once (`DELETE`); a recipient
 * reads it through their own copy (`GET /trips/:id/shared-route`). Nothing
 * is shared until the owner asks.
 *
 * Tiers: building and reading a route derive from TravTrack (`on`); the
 * owner's view of what is shared is `held`; revoking is `open` — taking back
 * what was shared never waits on a switch.
 */

const router = Router();

/**
 * Per reader: a read narrows every stored route of the group at request time.
 * Bounded by the stored vertices, not the owner's history — but a loop still
 * spends the server, and a map asks once per view. Mounted after
 * `authenticate`, so the bucket is the reader's.
 */
const sharedRouteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: patAwareMax(30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many shared-route reads, please try again later" },
  keyGenerator: userOrIpKey,
});

function route(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}

router.get(
  "/trips/:id/share-snapshot",
  authenticate,
  travTrackTier("held"),
  route(async (req, res) => {
    res.json({ snapshot: await tripRouteSnapshot(req.userId!, req.params.id) });
  })
);

router.put(
  "/trips/:id/share-snapshot",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    const snapshot = await shareTripRoute(req.userId!, req.params.id);
    logger.info({
      operation: "travtrack.share_snapshot.build",
      tripId: req.params.id,
      version: snapshot.version,
      vertices: snapshot.pointCount,
    });
    res.json({ snapshot });
  })
);

router.delete(
  "/trips/:id/share-snapshot",
  authenticate,
  travTrackTier("open"),
  requireWriteScope,
  route(async (req, res) => {
    const revoked = await revokeTripRoute(req.userId!, req.params.id);
    logger.info({ operation: "travtrack.share_snapshot.revoke", tripId: req.params.id, revoked });
    res.status(204).end();
  })
);

router.get(
  "/trips/:id/shared-route",
  authenticate,
  sharedRouteLimiter,
  travTrackTier("on"),
  route(async (req, res) => {
    const routes = await sharedTripRoutes(req.userId!, req.params.id);
    if (routes.length === 0) {
      throw new AppError(
        "Nobody shares a route of this trip with you",
        404,
        "SHARED_ROUTE_NOT_FOUND"
      );
    }
    res.json({ routes });
  })
);

export default router;
