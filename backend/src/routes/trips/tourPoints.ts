import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { tourPointsSchema } from "../../schemas/tour";
import { replaceTourPoints } from "../../services/tour/replaceTourPoints";
import { resolveRoute, toDto, toLegDto } from "./tourRoutes";

/**
 * The point list of a STANDALONE tour — one that belongs to no trip.
 *
 * A section of a trip draws its vertices from that trip's timeline
 * (`PUT /trips/:id/routes/:routeId/stops` assigns existing stops). A
 * standalone tour has no timeline to draw from, so its points are authored
 * here: the body carries the complete, ordered list. The write itself —
 * and the refusal of a tour that has a trip — lives in `replaceTourPoints`,
 * which the spreadsheet import shares.
 */
const router = Router();

router.put(
  "/tours/:routeId/points",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoute(userId, undefined, req.params.routeId);
      const { points } = tourPointsSchema.parse(req.body);
      const { route, stops, legs } = await replaceTourPoints(userId, routeId, points);
      res.json({ route: toDto(route), stops, legs: legs.map(toLegDto) });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
