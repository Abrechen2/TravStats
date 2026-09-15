/**
 * Stays — the episodes of a lodging.
 *
 * Split out of `routes/lodging.ts` on 2026-09-15 to bring it back under the
 * 800-line limit, and the seam holds on its own: a lodging is a PLACE, a stay
 * is a visit to it. The two have different lifetimes, different validation and
 * different money (a stay carries the price, the lodging does not).
 *
 * Paths are unchanged and nested under `/:id`, mounted from the lodging router
 * so Express matches in exactly the order it did before.
 */

import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { recheckAchievements } from "../../utils/achievements";
import { deriveLodgingStatus } from "../../shared/statusDerivation";
import { deriveStayOverallRating } from "../../shared/ratingDerivation";
import { deriveStayTotalPrice } from "../../shared/stayPricing";
import { createStaySchema, updateStaySchema } from "../../schemas/lodging";
import logger from "../../utils/logger";
import { assertReferencesOwned } from "../../utils/ownedReferences";
import { resolveEffectiveStayDates } from "../../services/lodging/stayPatchMerge";
import { getBaseCurrency } from "../../services/fx/snapshot";
import { requireUser } from "../../middleware/auth";
import {
  applyFxSnapshot,
  applyManualRate,
  resolveFxFields,
  type FxSnapshotFields,
} from "../../services/fx/stayFx";

const router = Router();

// ---- Stay CRUD (nested under a lodging) ----

router.post("/:id/stays", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const lodging = await prisma.lodging.findFirst({ where: { id: req.params.id, userId } });
    if (!lodging) throw new AppError("Lodging not found", 404);

    const parsed = createStaySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    // Prisma only enforces that the trip, booking and membership EXIST — not
    // whose they are. Without this, a stay could be filed under a stranger's
    // trip and would then show up on their timeline (AUD-038).
    await assertReferencesOwned(userId, parsed.data);
    // totalPrice is the source of truth: the UI types it, but an importer or
    // API client may send only a per-night price — derive the total so it is
    // always stored, and the FX snapshot below converts the right amount.
    // `manualFxRate` is a request field, not a stay column — it must not reach
    // the spread below, where Prisma would reject it as an unknown argument.
    const { manualFxRate, ...body } = parsed.data;
    const input = { ...body, totalPrice: deriveStayTotalPrice(body) };

    const baseCurrency = await getBaseCurrency(userId);
    const fxOutcome = await applyFxSnapshot(input, baseCurrency);
    if (fxOutcome.status === "lookupFailed") {
      logger.warn({ operation: "lodging_fx_lookup_failed", lodgingId: lodging.id, userId });
    }
    const fxFields =
      manualFxRate != null
        ? applyManualRate(
            fxOutcome,
            manualFxRate,
            input.totalPrice,
            // A manual rate still needs a day to be stamped with. An undated
            // stay cannot have one, and applyFxSnapshot has already refused
            // the conversion above — this argument is then never read.
            input.checkIn ?? new Date(),
            baseCurrency,
          )
        : resolveFxFields(fxOutcome);

    const stay = await prisma.lodgingStay.create({
      data: {
        ...input,
        ...fxFields,
        // Status follows the dates (see deriveLodgingStatus). Whatever the
        // client sent is only consulted for the one value derivation honours,
        // "cancelled" — so an old client, an importer or a stale form can no
        // longer store a status the dates contradict.
        // With no dates there is nothing to derive from and the deriver
        // returns `current` — which is correct: an undated stay is recorded
        // after the fact, so what the client says is a statement, not a cache.
        status: deriveLodgingStatus({
          checkIn: input.checkIn ? new Date(input.checkIn) : null,
          checkOut: input.checkOut ? new Date(input.checkOut) : null,
          current: input.status,
        }),
        // Likewise derived, not accepted: the overall score follows the three
        // components wherever a stay is written — form, CSV, e-mail/PDF — so
        // an importer cannot leave it null and a client cannot store one that
        // contradicts them. `current` only carries a source-supplied overall
        // through for a stay that has no component rating at all.
        ratingOverall: deriveStayOverallRating({
          room: input.ratingRoom ?? null,
          breakfast: input.ratingBreakfast ?? null,
          service: input.ratingService ?? null,
          current: input.ratingOverall ?? null,
        }),
        lodgingId: lodging.id,
        userId,
      },
    });

    await recheckAchievements(userId, "lodging");
    logger.info({ operation: "lodging_stay_create", stayId: stay.id, lodgingId: lodging.id, userId });
    res.status(201).json({ success: true, data: stay });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/stays/:stayId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const lodging = await prisma.lodging.findFirst({ where: { id: req.params.id, userId } });
    if (!lodging) throw new AppError("Lodging not found", 404);

    const stay = await prisma.lodgingStay.findFirst({
      where: { id: req.params.stayId, lodgingId: lodging.id, userId },
    });
    if (!stay) throw new AppError("Stay not found", 404);

    const parsed = updateStaySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    // Re-linking is a write too — see the create path (AUD-038).
    await assertReferencesOwned(userId, parsed.data);
    // Same reason as the create path: this one is not a stay column.
    const { manualFxRate, ...input } = parsed.data;

    // The whole merge rule, and the trap in it, live in `stayPatchMerge`.
    const effective = resolveEffectiveStayDates(input, stay);
    const effectiveCheckIn = effective.checkIn;
    const effectiveCheckOut = effective.checkOut;

    // Times are claims about a DAY-precise date (see schemas/lodging.ts).
    // The schema can only check the body; here the MERGED stay is checked:
    // an explicit time the merged stay cannot carry is a contradiction and
    // refused, while a STORED time whose date/precision is being edited away
    // is cleared alongside — the row must never carry a time without its day.
    const effectiveDatePrecision = effective.datePrecision;
    // Feeds the price derivation below: a stay whose length is stated rather
    // than measured still has one (AUD-040).
    const effectiveNights = effective.nights;
    const supportsTime = (date: Date | null): boolean =>
      date !== null && effectiveDatePrecision === "DAY";
    if (input.checkInTime != null && !supportsTime(effectiveCheckIn)) {
      throw new AppError("checkInTime requires a DAY-precision check-in date", 400);
    }
    if (input.checkOutTime != null && !supportsTime(effectiveCheckOut)) {
      throw new AppError("checkOutTime requires a DAY-precision check-out date", 400);
    }
    const timeClears = {
      ...(input.checkInTime === undefined && stay.checkInTime !== null && !supportsTime(effectiveCheckIn)
        ? { checkInTime: null }
        : {}),
      ...(input.checkOutTime === undefined &&
      stay.checkOutTime !== null &&
      !supportsTime(effectiveCheckOut)
        ? { checkOutTime: null }
        : {}),
    };

    // Only re-run the FX snapshot when a field that feeds the conversion
    // ACTUALLY CHANGED VALUE — an unrelated edit (e.g. notes) must not touch
    // a previously-good snapshot, and must never fail the request either way.
    //
    // This MUST be a value comparison, not a key-presence check ("totalPrice"
    // in input): the real StayEditor UI always sends checkIn/checkOut/
    // status/currency/board/isAwardStay unconditionally, re-sending the
    // stay's EXISTING totalPrice/currency/checkIn on every edit (e.g. a
    // notes-only edit). A key-presence check would treat every such edit as
    // "FX inputs changed" and — if the ECB lookup happens to be down at that
    // moment — silently clear a perfectly good historical snapshot (finding
    // 1, CRITICAL). Comparing against the CURRENT stored values means a
    // resend of the same value is correctly seen as "nothing changed".
    // totalPrice is authoritative, and what the client EXPLICITLY sends drives
    // the result — a stored total must not override a field the user just
    // changed:
    //   - an explicit totalPrice (incl. null = clear) wins outright;
    //   - else an explicit pricePerNight re-derives total = per-night × nights;
    //   - else nothing pricing-relevant was sent, so the stored total stands.
    // `undefined` means "not sent"; an explicit `null` is a clear and survives.
    let effectiveTotalPrice: number | null;
    if (input.totalPrice !== undefined) {
      effectiveTotalPrice = input.totalPrice;
    } else if (input.pricePerNight !== undefined) {
      effectiveTotalPrice = deriveStayTotalPrice({
        totalPrice: null,
        pricePerNight: input.pricePerNight,
        checkIn: effectiveCheckIn,
        checkOut: effectiveCheckOut,
        datePrecision: effectiveDatePrecision,
        nights: effectiveNights,
      });
    } else {
      // Dates alone can change what a per-night-priced stay costs, but only when
      // the total was itself derived from per-night (no explicit total on file).
      effectiveTotalPrice =
        stay.totalPrice ??
        deriveStayTotalPrice({
          totalPrice: null,
          pricePerNight: stay.pricePerNight,
          checkIn: effectiveCheckIn,
          checkOut: effectiveCheckOut,
          datePrecision: effectiveDatePrecision,
          nights: effectiveNights,
        });
    }

    // A manual rate sent on its own changes NOTHING about price, currency or
    // date — it is the ordinary way a user fills the gap after saving a stay
    // they were told had no rate. Without this the recompute below would skip,
    // and the rate they just typed would be dropped without a word.
    const fxInputsChanged =
      manualFxRate !== undefined ||
      effectiveTotalPrice !== stay.totalPrice ||
      (input.currency !== undefined && input.currency !== stay.currency) ||
      (input.checkIn !== undefined &&
        (input.checkIn === null
          ? stay.checkIn !== null
          : new Date(input.checkIn).getTime() !== (stay.checkIn?.getTime() ?? NaN)));
    let fxFields: Partial<FxSnapshotFields> = {};
    if (fxInputsChanged) {
      const baseCurrency = await getBaseCurrency(userId);
      const fxOutcome = await applyFxSnapshot(
        {
          totalPrice: effectiveTotalPrice,
          currency: input.currency ?? stay.currency,
          checkIn: effectiveCheckIn,
        },
        baseCurrency,
      );
      if (fxOutcome.status === "lookupFailed") {
        logger.warn({ operation: "lodging_fx_lookup_failed", stayId: stay.id, userId });
      }
      // An explicit null is the user TAKING THE RATE BACK: fall through to the
      // automatic answer, which for a gap currency is "no rate" — the honest
      // state, not the old estimate left standing.
      fxFields =
        manualFxRate != null
          ? applyManualRate(
              fxOutcome,
              manualFxRate,
              effectiveTotalPrice,
              effectiveCheckIn ?? new Date(),
              baseCurrency,
            )
          : resolveFxFields(fxOutcome);
    }

    // Same merge rule as the dates above, and the same explicit-null trap as
    // the FX block: `undefined` means "not sent" and falls back to the stored
    // value, while an explicit `null` is the user CLEARING that rating and
    // must survive into the derivation. `??` would collapse the two and make
    // a cleared component silently keep its old score.
    const effectiveRating = (
      sent: number | null | undefined,
      stored: number | null,
    ): number | null => (sent !== undefined ? sent : stored);

    const updated = await prisma.lodgingStay.update({
      where: { id: stay.id },
      data: {
        ...input,
        ...timeClears,
        // totalPrice is authoritative and derived above from the merged view,
        // so it overrides whatever `...input` carried (which may be a stale
        // re-send or absent while only the per-night price changed).
        totalPrice: effectiveTotalPrice,
        ...fxFields,
        // Derived from the EFFECTIVE (merged) dates, not from `input`, so a
        // PATCH that moves only one date still re-derives against the range
        // that will actually be stored. `current` is likewise the effective
        // status — a body omitting `status` must not lose an existing
        // cancellation, which is the one value derivation passes through.
        status: deriveLodgingStatus({
          checkIn: effectiveCheckIn,
          checkOut: effectiveCheckOut,
          current: input.status ?? stay.status,
        }),
        // Derived from the EFFECTIVE (merged) ratings for the same reason: a
        // PATCH sending one component must score the row that will actually
        // be stored, not the partial body.
        ratingOverall: deriveStayOverallRating({
          room: effectiveRating(input.ratingRoom, stay.ratingRoom),
          breakfast: effectiveRating(input.ratingBreakfast, stay.ratingBreakfast),
          service: effectiveRating(input.ratingService, stay.ratingService),
          current: effectiveRating(input.ratingOverall, stay.ratingOverall),
        }),
      },
    });

    await recheckAchievements(userId, "lodging");
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/stays/:stayId", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const lodging = await prisma.lodging.findFirst({ where: { id: req.params.id, userId } });
    if (!lodging) throw new AppError("Lodging not found", 404);

    const stay = await prisma.lodgingStay.findFirst({
      where: { id: req.params.stayId, lodgingId: lodging.id, userId },
    });
    if (!stay) throw new AppError("Stay not found", 404);

    await prisma.lodgingStay.delete({ where: { id: stay.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
