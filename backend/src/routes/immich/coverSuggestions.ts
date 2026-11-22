/**
 * Cover suggestions for a trip. Nothing here sets a cover on its own:
 * `GET` returns up to three photos with the reasons, the user picks one, and
 * the cover is written through the existing routes (`tripCover.ts`).
 *
 * `POST /trips/:id/cover/entry-photo` is the one new setter: a photo linked to
 * one of the trip's entries (a flight, a stay, …) belongs to no album of the
 * trip, so the album route cannot name it.
 */
import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { immichProxyLimiter } from "../../middleware/rateLimit";
import { resolveTrip } from "../trips";
import { ENTRY_FK, type EntryKind } from "../../services/photoLinking/entryKinds";
import { suggestCover } from "../../services/coverSuggestions/suggest";
import logger from "../../utils/logger";

const router = Router();

const entryCoverSchema = z.object({ linkId: z.string().uuid() }).strict();

/** The entry kinds that file under a trip directly; the rest cannot be a trip's cover source here. */
const TRIP_ENTRY_KINDS = ["flight", "stay", "rail", "bus", "ferry", "rental"] as const;

router.get(
  "/trips/:id/cover-suggestions",
  authenticate,
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await resolveTrip(req.userId!, req.params.id);
      res.json(await suggestCover(req.userId!, req.params.id));
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/trips/:id/cover/entry-photo",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);
      const { linkId } = entryCoverSchema.parse(req.body);

      const link = await prisma.entryPhotoLink.findFirst({
        where: { id: linkId, userId, refused: false },
        select: {
          flightId: true,
          lodgingStayId: true,
          railJourneyId: true,
          busJourneyId: true,
          ferryJourneyId: true,
          rentalId: true,
          flight: { select: { tripId: true } },
          lodgingStay: { select: { tripId: true } },
          railJourney: { select: { tripId: true } },
          busJourney: { select: { tripId: true } },
          ferryJourney: { select: { tripId: true } },
          rental: { select: { tripId: true } },
        },
      });
      if (!link) throw new AppError("notFound", 404);

      // The entry must be on THIS trip: a link id of another trip's entry is not a cover here.
      const found = TRIP_ENTRY_KINDS.map((kind) => {
        const fk = ENTRY_FK[kind];
        const relation = {
          flight: link.flight,
          stay: link.lodgingStay,
          rail: link.railJourney,
          bus: link.busJourney,
          ferry: link.ferryJourney,
          rental: link.rental,
        }[kind];
        return { kind, entryId: link[fk as keyof typeof link] as string | null, relation };
      }).find((e) => e.entryId && e.relation?.tripId === tripId);
      if (!found) throw new AppError("notFound", 404);

      const coverImageUrl = `/api/v1/entry-photos/${found.kind as EntryKind}/${found.entryId}/photos/${linkId}/file?size=preview`;
      await prisma.trip.update({ where: { id: tripId }, data: { coverImageUrl } });
      logger.info({ message: "entry_photo_cover_set", context: { tripId, kind: found.kind } });
      res.json({ coverImageUrl });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
