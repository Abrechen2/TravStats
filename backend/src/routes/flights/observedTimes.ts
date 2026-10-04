import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { flightDeviceDataLimiter } from "../../middleware/rateLimit";
import { observedTimesSchema } from "../../schemas/flightDevice";
import { recordObservedTimes, refuseObservation } from "../../services/flightDevice/observedTimes";
import { now as clockNow } from "../../shared/time/clock";

/**
 * `POST /api/v1/flights/:id/observed-times` — the takeoff and/or landing a
 * paired phone saw (forgejo#194). Its own endpoint rather than a by-product of
 * the track upload: the phone knows it landed the moment it lands, with its
 * raw sensor stream in hand, and this message is a few bytes it can send from
 * the taxiway, long before a recording of thousands of points gets through.
 * The stored recording is simplified and keeps no speeds, so the server could
 * only ever guess worse at the same moment.
 *
 * What happens to the times is `services/flightDevice/observedTimes.ts`. Bare
 * responses, like every flights router (ADR 0001).
 */

const router = Router();
router.use("/:id/observed-times", authenticate, requireWriteScope, flightDeviceDataLimiter);

router.post("/:id/observed-times", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    // Owner check first: another user's flight answers 404 whatever the body.
    const flight = await prisma.flight.findFirst({ where: { id: req.params.id, userId } });
    if (!flight) throw new AppError("Flight not found", 404);

    const observed = observedTimesSchema.parse(req.body);
    const refusal = await refuseObservation(flight, observed, clockNow());
    if (refusal) {
      throw new AppError(
        "This observation cannot belong to this flight",
        refusal.status,
        refusal.code,
        refusal.field
      );
    }

    const result = await recordObservedTimes(flight, observed, {
      userId,
      deviceId: req.apiToken?.deviceId ?? null,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
