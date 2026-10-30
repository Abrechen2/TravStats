import type { NextFunction, Response } from "express";

import { prisma } from "../../db";
import type { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { recheckAchievements } from "../../utils/achievements";
import { restatusTrips } from "../../services/trip/restatusTrips";
import { propagateDelete, shareSnapshot } from "../../services/sharing/propagate";

/**
 * `DELETE /flights/:id`. Lifted out of `routes/flights.ts`, which is frozen at
 * its size and may only shrink. A flight of a shared trip is deleted here
 * only: the other members get a notice and keep their copies (design
 * 2026-10-09, decision 3).
 */
export async function deleteFlightHandler(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const existingFlight = await prisma.flight.findFirst({ where: { id, userId } });
    if (!existingFlight) throw new AppError("Flight not found", 404);

    await prisma.$transaction(async (tx) => {
      const gone = await shareSnapshot(tx, "flight", id);
      await tx.flight.delete({ where: { id, userId } });
      await propagateDelete(tx, userId, gone);
      // The flight stretched its trip's span; re-derived in the same
      // transaction, so a failure cannot leave it deleted and the trip stale.
      await restatusTrips([existingFlight.tripId], tx);
    });
    // Badges are rechecked after the commit; that check logs and swallows.
    await recheckAchievements(userId, "flight delete");
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
