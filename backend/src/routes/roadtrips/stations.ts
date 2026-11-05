import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { stationsSchema } from "../../schemas/roadtrip";
import { nightsOf, toStationDto } from "../../services/roadtrip/roadtripSummary";
import { replaceStations } from "../../services/roadtrip/replaceStations";
import { toDto, toLegDto } from "../trips/tourRoutes";
import logger from "../../utils/logger";
import { resolveRoadtrip } from "../../services/roadtrip/resolveRoadtrip";
import { stationWeather } from "../../services/roadtrip/stationWeather";
import { openDataLimiter } from "../../middleware/rateLimit";

const router = Router();

/**
 * PUT /roadtrips/:id/stations
 *
 * The complete, ordered station list — added, moved, removed, renumbered and
 * re-linked in one write, the same all-or-nothing shape as a standalone
 * tour's `/points`. The rules live in `replaceStations`, which the
 * spreadsheet import shares. With `expectedStationIds` the write is refused
 * (409 `ROADTRIP_STATIONS_CHANGED`) when the stored stations are no longer the
 * set the writer read — see the schema.
 */
router.put(
  "/roadtrips/:id/stations",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoadtrip(userId, req.params.id);
      const { stations, expectedStationIds } = stationsSchema.parse(req.body);
      const {
        route,
        legs,
        stations: saved,
      } = await replaceStations(userId, routeId, stations, { expectedStationIds });

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

/**
 * GET /roadtrips/:id/stations/:stationId/weather
 *
 * The measured weather of the station's arrival day (Open-Meteo), computed per
 * request and stored nowhere. Always 200 with an `outcome`: a service failure
 * (`timeout`, `rateLimited`, `unavailable`) is told apart from an answer about
 * the day (`noData`, `futureOrToday`) so the page keeps what it already shows.
 */
router.get(
  "/roadtrips/:id/stations/:stationId/weather",
  authenticate,
  requireWriteScope,
  openDataLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const routeId = await resolveRoadtrip(userId, req.params.id);
      res.json(await stationWeather(userId, routeId, req.params.stationId));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
