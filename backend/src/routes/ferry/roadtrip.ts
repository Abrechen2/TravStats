import { Router, type NextFunction, type Response } from "express";
import { Prisma } from "../../prisma";
import { prisma, type DbTransaction } from "../../db";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { z } from "../../schemas/zod";
import { recomputeTripStatus } from "../../services/tripStatusService";
import logger from "../../utils/logger";

const router = Router();
router.use(authenticate, requireWriteScope);

/** How many legs the picker offers; the answer says when there were more. */
const LEG_PICKER_LIMIT = 500;

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
      // computedAt is not unique (a save writes many legs at once), so the id
      // keeps the cut at the limit stable between two openings of the picker.
      orderBy: [{ computedAt: "desc" }, { id: "asc" }],
      take: LEG_PICKER_LIMIT + 1,
    });
    const truncated = legs.length > LEG_PICKER_LIMIT;
    res.json({
      success: true,
      data: legs.slice(0, LEG_PICKER_LIMIT),
      meta: { truncated },
    });
  } catch (error) {
    next(error);
  }
});

type Tx = DbTransaction;

/** The routing a link overwrites, kept on the crossing so it can be given back. */
const legRouting = z.object({
  mode: z.string(),
  source: z.string(),
  confidence: z.string(),
  distanceKm: z.number(),
  drivingMinutes: z.number().int().nullable(),
  waypoints: z.unknown().nullable(),
});
type LegRouting = z.infer<typeof legRouting>;

function snapshotOf(leg: LegRouting): Prisma.InputJsonValue {
  return {
    mode: leg.mode,
    source: leg.source,
    confidence: leg.confidence,
    distanceKm: leg.distanceKm,
    drivingMinutes: leg.drivingMinutes,
    waypoints: leg.waypoints ?? null,
  } as unknown as Prisma.InputJsonValue;
}

/**
 * Give an unlinked leg back its routing. Only while the leg still holds what
 * linking wrote (a straight ferry leg): an edit made after linking is the
 * user's newer word and is kept. A link made before the snapshot existed has
 * nothing to restore and leaves the leg as it is.
 */
async function restoreLeg(tx: Tx, legId: string, stored: unknown): Promise<void> {
  const parsed = legRouting.safeParse(stored);
  if (!parsed.success) {
    if (stored !== null && stored !== undefined)
      logger.warn({ operation: "ferry.roadtripLeg.restore", legId }, "unreadable leg snapshot");
    return;
  }
  const before = parsed.data;
  await tx.tripRouteLeg.updateMany({
    where: { id: legId, mode: "ferry", source: "straight" },
    data: {
      mode: before.mode,
      source: before.source,
      confidence: before.confidence,
      distanceKm: before.distanceKm,
      drivingMinutes: before.drivingMinutes,
      waypoints:
        before.waypoints === null
          ? Prisma.DbNull
          : (before.waypoints as unknown as Prisma.InputJsonValue),
    },
  });
}

/**
 * Link an existing crossing and leg atomically; road kilometres exclude
 * mode=ferry. Linking used to wipe the leg's road routing for good — an
 * unlink or a relink to another leg left a straight ferry leg where a routed
 * road had been. The routing is now kept on the crossing and given back.
 */
router.put("/:id/roadtrip-leg", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = z.object({ legId: z.string().uuid().nullable() }).safeParse(req.body);
    if (!parsed.success) throw new AppError("Invalid leg", 400);
    const result = await prisma.$transaction(async (tx) => {
      const ferry = await tx.ferryJourney.findFirst({
        where: { id: req.params.id, userId: req.userId! },
      });
      if (!ferry) throw new AppError("Crossing not found", 404);
      const previousLegId = ferry.roadtripLegId;
      if (!parsed.data.legId) {
        if (previousLegId) await restoreLeg(tx, previousLegId, ferry.roadtripLegBefore);
        await tx.ferryJourney.update({
          where: { id: ferry.id },
          data: { roadtripLegId: null, roadtripLegBefore: Prisma.DbNull },
        });
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
      const relinkSame = previousLegId === leg.id;
      if (previousLegId && !relinkSame)
        await restoreLeg(tx, previousLegId, ferry.roadtripLegBefore);
      await tx.ferryJourney.update({
        where: { id: ferry.id },
        data: {
          roadtripLegId: leg.id,
          tripId: leg.route.tripId,
          // Linking the same leg again keeps the original routing, not the
          // ferry state the first link wrote.
          ...(relinkSame ? {} : { roadtripLegBefore: snapshotOf(leg) }),
        },
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
      return { tripId: leg.route.tripId };
    });
    if (result.tripId) await recomputeTripStatus(result.tripId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
export default router;
