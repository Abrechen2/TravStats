import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { rentalDrivenKm } from "../../shared/rentalCounting";
import { now as clockNow } from "../../shared/time/clock";
import { serializeTime } from "../../shared/time/wire";

/**
 * GET /api/v1/rentals/invoice-reminders — rentals whose km still wait for
 * their final invoice (spec 2026-10-01-rental-domain-design §11 D11 b). With
 * no invoice in either corpus, the km of every rental depend on the user
 * fetching it from the provider's portal; this is the list the Companion (and
 * the web) remind about: returned within the last `REMINDER_WINDOW_DAYS`,
 * not cancelled, and no driven km yet — from an invoice, a correction or both
 * odometer readings (`rentalDrivenKm`, forgejo#206).
 *
 * The signal is per rental, not a counter, so a client can say WHICH rental
 * it is about. The rental domain's beta switch is the client's to apply, as
 * for every rental endpoint.
 */
export const REMINDER_WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const router = Router();
router.use(authenticate);

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const now = clockNow();
    const rows = await prisma.rentalBooking.findMany({
      where: {
        userId: req.userId as string,
        status: "completed",
        distanceKm: null,
        returnTime: { gte: new Date(now.getTime() - REMINDER_WINDOW_DAYS * DAY_MS), lte: now },
      },
      orderBy: [{ returnTime: "desc" }, { id: "desc" }],
      select: {
        id: true,
        provider: true,
        confirmationNumber: true,
        returnStationName: true,
        returnTime: true,
        returnTimezone: true,
        returnPrecision: true,
        distanceKm: true,
        distanceSource: true,
        odometerOutKm: true,
        odometerInKm: true,
      },
    });
    // The query already left out every row with a stored figure; this drops
    // the ones whose two odometer readings give the km — the same rule the
    // row's own `invoiceMissing` flag reads.
    const missing = rows.filter((r) => rentalDrivenKm(r) === null);
    res.json({
      success: true,
      data: missing.map((r) => ({
        rentalId: r.id,
        provider: r.provider,
        confirmationNumber: r.confirmationNumber,
        returnStationName: r.returnStationName,
        returnedAt: serializeTime(
          r.returnTime,
          r.returnTimezone,
          r.returnPrecision === "day" ? "day" : "minute"
        ),
        reason: "invoiceMissing" as const,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
