import { Router, Response, NextFunction } from "express";
import { prisma } from "../db";
import { authenticate, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { isCurrencyCode } from "../shared/currencies";
import { fxPreviewLimiter } from "../middleware/rateLimit";
import { resolveRate } from "../services/fx/resolver";
import { getBaseCurrency } from "../services/fx/snapshot";

// `/recent` reads the currencies the caller has already used, from their own
// rows, and needs no limiter. `/display-rate` asks the FX chain (cached per
// pair and day) and carries the same `fxPreviewLimiter` as `/lodging/fx-preview`.
const router = Router();
router.use(authenticate);

/**
 * The currencies THIS user actually books in, most-used first.
 *
 * Derived, never stored: a picker offering 155 codes is unusable, and any
 * hand-kept "favourites" list would be a second thing to age. Four domains
 * and the roadtrip expenses are counted because a traveller's currencies are not per-domain — someone
 * who flies to Oslo also sleeps there.
 */
router.get("/recent", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) throw new AppError("Not authenticated", 401);

    const [stays, cruises, flights, bookings, expenses] = await Promise.all([
      prisma.lodgingStay.groupBy({ by: ["currency"], where: { userId }, _count: true }),
      prisma.cruise.groupBy({ by: ["currency"], where: { userId }, _count: true }),
      prisma.flight.groupBy({ by: ["currency"], where: { userId }, _count: true }),
      prisma.booking.groupBy({ by: ["currency"], where: { userId }, _count: true }),
      // A ferry ticket or fuel on a roadtrip (forgejo#140) is paid in the same
      // currencies as the stays around it.
      prisma.tripExpense.groupBy({ by: ["currency"], where: { userId }, _count: true }),
    ]);

    const tally = new Map<string, number>();
    for (const row of [...stays, ...cruises, ...flights, ...bookings, ...expenses]) {
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

/**
 * The one rate the web needs to show a base-currency total in the account's display
 * currency (settings v3 `cur`). Conversion rules live here and in the FX chain: the
 * client multiplies, it never looks a rate up itself. `rate` is null when the chain
 * has none (offline, unknown pair, external services off) — the client then shows
 * the base amount with its own currency instead of a guessed number.
 */
router.get("/display-rate", fxPreviewLimiter, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.userId;
    if (!userId) throw new AppError("Not authenticated", 401);
    const [base, settings] = await Promise.all([
      getBaseCurrency(userId),
      prisma.userSettings.findUnique({ where: { userId }, select: { displayCurrency: true } }),
    ]);
    const display = settings?.displayCurrency ?? base;
    if (display === base) {
      res.json({ success: true, data: { base, display, rate: 1, rateDate: null, source: null } });
      return;
    }
    const rateDate = new Date().toISOString().slice(0, 10);
    const found = await resolveRate(base, display, rateDate);
    res.json({
      success: true,
      data: {
        base,
        display,
        rate: found?.rate ?? null,
        rateDate: found ? rateDate : null,
        source: found?.source ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
