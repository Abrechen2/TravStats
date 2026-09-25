import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { openDataLimiter } from "../middleware/rateLimit";
import { assertOpenDataEnabled, OpenDataDisabledError } from "../services/openData/http";
import { fillTripJournalWeather, refreshJournalWeather } from "../services/openData/journalWeather";
import { enrichLodgingFromOsm } from "../services/openData/lodgingEnrichment";
import { nearbyLodgings } from "../services/openData/openStreetMap";
import { wikidataForPlace } from "../services/openData/placeWikidata";
import { plannedElevationProfile } from "../services/openData/plannedProfile";
import { WIKI_LANGUAGES, wikipediaSummary } from "../services/openData/wikipedia";
import { buildRouteGeometry } from "./trips/tourLegs";
import { resolveRoute } from "./trips/tourRoutes";
import { resolveTrip } from "./trips/resolveTrip";

/**
 * Open data (2026-09-24): the day's weather for a journal entry, the
 * elevation profile of a planned tour, a Wikipedia summary for a place or a
 * house, and a house's facts from OpenStreetMap (beta `lodgingEnrichment`).
 *
 * Every endpoint answers 409 `{ error: "openDataDisabled" }` while the
 * instance switch is off — the request is fine, the instance is not set up to
 * answer it — and each is rate limited, because the free services behind it
 * judge the instance's address, not the user's. Bare response family.
 */

const router = Router();

const langQuery = z.object({ lang: z.enum(WIKI_LANGUAGES).default("en") });

function sendDisabled(error: unknown, res: Response): boolean {
  if (!(error instanceof OpenDataDisabledError)) return false;
  res.status(409).json({ error: "openDataDisabled", message: error.message });
  return true;
}

/** POST /trips/:id/journal/weather — fill every entry of the trip that has none yet. */
router.post(
  "/trips/:id/journal/weather",
  authenticate,
  requireWriteScope,
  rejectDemo,
  openDataLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const trip = await resolveTrip(req.userId!, req.params.id);
      await assertOpenDataEnabled();
      const filled = await fillTripJournalWeather(trip.id);
      const entries = await prisma.tripJournalEntry.findMany({
        where: { tripId: trip.id },
        orderBy: { date: "asc" },
      });
      res.json({ filled, entries });
    } catch (error) {
      if (!sendDisabled(error, res)) next(error);
    }
  }
);

/** POST /trips/:id/journal/:entryId/weather — fetch one entry's weather again. */
router.post(
  "/trips/:id/journal/:entryId/weather",
  authenticate,
  requireWriteScope,
  rejectDemo,
  openDataLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const trip = await resolveTrip(req.userId!, req.params.id);
      const existing = await prisma.tripJournalEntry.findFirst({
        where: { id: req.params.entryId, tripId: trip.id },
        select: { id: true },
      });
      if (!existing) throw new AppError("Journal entry not found", 404);
      await assertOpenDataEnabled();
      res.json({ entry: await refreshJournalWeather(existing.id) });
    } catch (error) {
      if (!sendDisabled(error, res)) next(error);
    }
  }
);

/** GET /tours/:routeId/planned-profile — elevation profile of the planned line. */
router.get(
  "/tours/:routeId/planned-profile",
  authenticate,
  openDataLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const routeId = await resolveRoute(req.userId!, undefined, req.params.routeId);
      await assertOpenDataEnabled();
      const geometry = await buildRouteGeometry(routeId);
      const profile = await plannedElevationProfile(
        geometry.features.map((f) => f.geometry.coordinates)
      );
      res.json({ profile });
    } catch (error) {
      if (!sendDisabled(error, res)) next(error);
    }
  }
);

/** GET /places/:id/wikipedia?lang= — summary of the place's Wikidata item, if it has one. */
router.get(
  "/places/:id/wikipedia",
  authenticate,
  openDataLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { lang } = langQuery.parse(req.query);
      const place = await prisma.place.findFirst({
        where: { id: req.params.id, userId: req.userId! },
        select: { id: true, wikidataId: true, curatedItemId: true, externalRef: true },
      });
      if (!place) throw new AppError("Place not found", 404);
      await assertOpenDataEnabled();
      const qid = await wikidataForPlace(place);
      res.json({ summary: qid ? await wikipediaSummary(qid, lang) : null });
    } catch (error) {
      if (!sendDisabled(error, res)) next(error);
    }
  }
);

/** GET /lodging/:id/wikipedia?lang= — summary of the house's Wikidata item, if it has one. */
router.get(
  "/lodging/:id/wikipedia",
  authenticate,
  openDataLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { lang } = langQuery.parse(req.query);
      const lodging = await prisma.lodging.findFirst({
        where: { id: req.params.id, userId: req.userId! },
        select: { wikidataId: true },
      });
      if (!lodging) throw new AppError("Lodging not found", 404);
      await assertOpenDataEnabled();
      res.json({
        summary: lodging.wikidataId ? await wikipediaSummary(lodging.wikidataId, lang) : null,
      });
    } catch (error) {
      if (!sendDisabled(error, res)) next(error);
    }
  }
);

const nearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(0.1).max(20).default(5),
});

/**
 * GET /nearby/lodging?lat=&lon=&radiusKm= — campsites, pitches and lodgings
 * near a point, from OpenStreetMap (companion#12). 502 when Overpass did not
 * answer: "none nearby" and "could not ask" are different answers.
 */
router.get(
  "/nearby/lodging",
  authenticate,
  openDataLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { lat, lon, radiusKm } = nearbyQuery.parse(req.query);
      await assertOpenDataEnabled();
      const places = await nearbyLodgings(lat, lon, radiusKm * 1000);
      if (places === null) throw new AppError("OpenStreetMap did not answer", 502);
      res.json({ places });
    } catch (error) {
      if (!sendDisabled(error, res)) next(error);
    }
  }
);

/** POST /lodging/:id/enrich — fill the house's empty fields from OpenStreetMap (beta). */
router.post(
  "/lodging/:id/enrich",
  authenticate,
  requireWriteScope,
  rejectDemo,
  openDataLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const exists = await prisma.lodging.findFirst({
        where: { id: req.params.id, userId: req.userId! },
        select: { id: true },
      });
      if (!exists) throw new AppError("Lodging not found", 404);
      await assertOpenDataEnabled();
      res.json(await enrichLodgingFromOsm(req.userId!, exists.id));
    } catch (error) {
      if (!sendDisabled(error, res)) next(error);
    }
  }
);

export default router;
