import { Router, type NextFunction, type Response } from "express";
import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { z } from "../../schemas/zod";
import { recomputeTripStatus } from "../../services/tripStatusService";
import { syncFerryLeg } from "../../services/ferry/ferryRouting";

const router = Router();
router.use(authenticate, requireWriteScope);
/** Only the reader's own roadtrip legs may be offered for a crossing. */
router.get("/roadtrip-legs", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const legs = await prisma.tripRouteLeg.findMany({
      where: { route: { userId: req.userId!, kind: "roadtrip" } },
      select: {
        id: true,
        mode: true,
        ferryJourney: { select: { id: true } },
        fromStop: { select: { title: true } },
        toStop: { select: { title: true } },
        route: { select: { name: true, tripId: true } },
      },
      orderBy: { computedAt: "desc" },
      take: 500,
    });
    res.json({ success: true, data: legs });
  } catch (error) {
    next(error);
  }
});
/** Link an existing crossing and leg atomically; road kilometres exclude mode=ferry. */
router.put("/:id/roadtrip-leg", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z.object({ legId: z.string().uuid().nullable() }).safeParse(req.body);
    if (!parsed.success) throw new AppError("Invalid leg", 400);
    const result = await prisma.$transaction(async (tx) => {
      const ferry = await tx.ferryJourney.findFirst({
        where: { id: req.params.id, userId: req.userId! },
      });
      if (!ferry) throw new AppError("Crossing not found", 404);
      if (!parsed.data.legId) {
        await tx.ferryJourney.update({ where: { id: ferry.id }, data: { roadtripLegId: null } });
        // An unlinked sea leg remains a ferry leg: unlinking does not turn sea into road.
        return { tripId: ferry.tripId };
      }
      const leg = await tx.tripRouteLeg.findFirst({
        where: { id: parsed.data.legId, route: { userId: req.userId!, kind: "roadtrip" } },
        include: { route: true, ferryJourney: { select: { id: true } } },
      });
      if (!leg) throw new AppError("Roadtrip leg not found", 404);
      if (leg.ferryJourney && leg.ferryJourney.id !== ferry.id)
        throw new AppError("Leg already has a crossing", 409);
      if (ferry.tripId && ferry.tripId !== leg.route.tripId)
        throw new AppError("Crossing and roadtrip must belong to the same trip", 409);
      await tx.ferryJourney.update({
        where: { id: ferry.id },
        data: { roadtripLegId: leg.id, tripId: leg.route.tripId },
      });
      // Road routing is no evidence for a sea crossing: clear its geometry and travel time.
      await tx.tripRouteLeg.update({
        where: { id: leg.id },
        data: {
          mode: "ferry",
          source: "straight",
          waypoints: Prisma.DbNull,
          confidence: "low",
          drivingMinutes: null,
          distanceKm: ferry.distanceKm ?? leg.distanceKm,
        },
      });
      if (ferry.geometrySource === "sea_route") {
        await syncFerryLeg(tx, { ...ferry, roadtripLegId: leg.id, tripId: leg.route.tripId });
      }
      return { tripId: leg.route.tripId };
    });
    if (result.tripId) await recomputeTripStatus(result.tripId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
export default router;
