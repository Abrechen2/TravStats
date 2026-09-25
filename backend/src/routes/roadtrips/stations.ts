import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { stationsSchema } from "../../schemas/roadtrip";
import { nightsOf, toStationDto } from "../../services/roadtrip/roadtripSummary";
import { replaceStations } from "../../services/roadtrip/replaceStations";
import { toDto, toLegDto } from "../trips/tourRoutes";
import logger from "../../utils/logger";
import { resolveRoadtrip } from "../../services/roadtrip/resolveRoadtrip";

const router = Router();

/**
 * PUT /roadtrips/:id/stations
 *
 * The complete, ordered station list — added, moved, removed, renumbered and
 * re-linked in one write, the same all-or-nothing shape as a standalone
 * tour's `/points`. The rules live in `replaceStations`, which the
 * spreadsheet import shares.
 */
router.put(
  "/roadtrips/:id/stations",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoadtrip(userId, req.params.id);
      const { stations } = stationsSchema.parse(req.body);
      const { route, legs, stations: saved } = await replaceStations(userId, routeId, stations);

      logger.info({ operation: "roadtrip.stations.replace", routeId, count: stations.length });
      res.json({
        roadtrip: toDto(route),
        nights: nightsOf(saved),
        stations: saved.map(toStationDto),
        legs: legs.map(toLegDto),
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
