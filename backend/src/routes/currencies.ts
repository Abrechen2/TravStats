import { Router, Response, NextFunction } from "express";
import { prisma } from "../db";
import { authenticate, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { isCurrencyCode } from "../shared/currencies";

// No rate limiter: `/recent` reads the currencies the caller has already used,
// from their own rows. Nothing here touches the FX upstream — the route that
// does is `/lodging/fx-preview`, and that one has `fxPreviewLimiter`.
const router = Router();
router.use(authenticate);

/**
 * The currencies THIS user actually books in, most-used first.
 *
 * Derived, never stored: a picker offering 155 codes is unusable, and any
 * hand-kept "favourites" list would be a second thing to age. Four domains
 * are counted because a traveller's currencies are not per-domain — someone
 * who flies to Oslo also sleeps there.
 */
router.get("/recent", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) throw new AppError("Not authenticated", 401);

    const [stays, cruises, flights, bookings] = await Promise.all([
      prisma.lodgingStay.groupBy({ by: ["currency"], where: { userId }, _count: true }),
      prisma.cruise.groupBy({ by: ["currency"], where: { userId }, _count: true }),
      prisma.flight.groupBy({ by: ["currency"], where: { userId }, _count: true }),
      prisma.booking.groupBy({ by: ["currency"], where: { userId }, _count: true }),
    ]);

    const tally = new Map<string, number>();
    for (const row of [...stays, ...cruises, ...flights, ...bookings]) {
      const code = row.currency;
      // Rows predating ISO-4217 validation can hold anything, including a
      // blank; offering such a value back as a choice would re-enter it.
      if (!isCurrencyCode(code)) continue;
      tally.set(code, (tally.get(code) ?? 0) + row._count);
    }

    const codes = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
    // The project's envelope, like every other route — this one answered a
    // bare `{codes}`, which every client would have had to special-case.
    res.json({ success: true, data: { codes } });
  } catch (error) {
    next(error);
  }
});

export default router;
