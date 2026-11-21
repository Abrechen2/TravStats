/**
 * A booking as a package (forgejo#430): every entry it sold, of every kind,
 * and the optional split of its one price across them. Spec
 * docs/superpowers/specs/2026-11-21-package-bookings.md.
 *
 * The split is stored on the booking and read back as a view that says when
 * it went stale. No split stored IS the answer "not split": every per-kind
 * statistic then abstains for the package's items (`shared/packageBooking.ts`),
 * and the trip cost keeps counting the price once.
 *
 * Bare response family, like the other booking routes (ADR 0001). Mounted
 * before `trips`, so `/trips/bookings/:id` is never read as a trip id.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { packageSplitBodySchema } from "../../schemas/flightBooking";
import {
  isPackage,
  loadBookingItems,
  payingItems,
  type BookingItem,
} from "../../services/booking/bookingItems";
import { computePackageSplit, type PackageSplitRefusal } from "../../services/booking/packageSplit";
import { itemKey, readBookingSplit } from "../../services/flights/bookingPriceSplit";

const router = Router();

const REFUSAL_STATUS: Record<PackageSplitRefusal, number> = {
  BOOKING_PRICE_MISSING: 409,
  BOOKING_SPLIT_SINGLE_SEGMENT: 409,
  BOOKING_SPLIT_ITEMS: 422,
  BOOKING_SPLIT_SUM: 422,
};

const BOOKING_SELECT = {
  id: true,
  pnr: true,
  operator: true,
  travellers: true,
  price: true,
  currency: true,
  tripId: true,
  trip: { select: { name: true } },
  priceSplit: true,
} as const;

async function ownBooking(userId: string, bookingId: string) {
  const row = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    select: BOOKING_SELECT,
  });
  if (!row) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
  return row;
}

/** The answer every route here gives: the booking, its items, and the split as it reads today. */
function packageAnswer(row: Awaited<ReturnType<typeof ownBooking>>, items: BookingItem[]) {
  const { priceSplit, trip, ...booking } = row;
  const split = readBookingSplit(
    priceSplit,
    booking,
    payingItems(items).map((i) => itemKey(i.kind, i.id))
  );
  const shares = new Map(
    split && !split.staleReason ? split.shares.map((s) => [itemKey(s.kind, s.id), s.amount]) : []
  );
  return {
    booking: { ...booking, tripName: trip?.name ?? null },
    isPackage: isPackage(items),
    items: items.map((i) => ({
      ...i,
      // The item's share of a valid split; null = not split (or not paid: cancelled).
      share: shares.get(itemKey(i.kind, i.id)) ?? null,
    })),
    split,
  };
}

/** GET /trips/bookings/:id — the booking, every entry it sold, and its split. */
router.get(
  "/trips/bookings/:id",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const row = await ownBooking(userId, req.params.id);
      res.json(packageAnswer(row, await loadBookingItems(userId, row.id)));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /trips/bookings/:id/split — equal across every paying item, or the
 * user's own amounts, which must name every paying item once and add up to
 * the total exactly.
 */
router.put(
  "/trips/bookings/:id/split",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const body = packageSplitBodySchema.parse(req.body);
      const row = await ownBooking(userId, req.params.id);
      const items = await loadBookingItems(userId, row.id);
      const result = computePackageSplit(row, payingItems(items), body);
      if ("refusal" in result) {
        throw new AppError(
          "The booking cannot be split this way",
          REFUSAL_STATUS[result.refusal],
          result.refusal
        );
      }
      const saved = await prisma.booking.update({
        where: { id: row.id },
        data: { priceSplit: result.split as unknown as Prisma.InputJsonValue },
        select: BOOKING_SELECT,
      });
      res.json(packageAnswer(saved, items));
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /trips/bookings/:id/split — back to "not split". */
router.delete(
  "/trips/bookings/:id/split",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const row = await ownBooking(userId, req.params.id);
      const saved = await prisma.booking.update({
        where: { id: row.id },
        data: { priceSplit: Prisma.DbNull },
        select: BOOKING_SELECT,
      });
      res.json(packageAnswer(saved, await loadBookingItems(userId, row.id)));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
