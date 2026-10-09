import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { enrichFlightsForClients } from "../../services/flightAirportFacts";
import {
  computeBookingSplit,
  readBookingSplit,
  type SplitRefusalCode,
} from "../../services/flights/bookingPriceSplit";
import { bookingSplitBodySchema } from "../../schemas/flightBooking";

/**
 * A flight's booking and its flight segments (forgejo#218), and the optional
 * split of the booking's price across them (forgejo#219).
 *
 * `GET /api/v1/flights/:id/booking`: only flights LINKED to the same booking
 * (`bookingId`) come back. Two flights that merely share a PNR string are not
 * a booking until something linked them; reading them as one would merge what
 * nobody merged. Segments are ordered by their stored departure instant, then
 * id. Whether two segments' order is actually KNOWN (a day-only departure) is
 * the web's judgement, made on the `times` each segment carries.
 *
 * `PUT` / `DELETE /api/v1/flights/:id/booking/split`: store or drop the split.
 * It never touches a price column — see `services/flights/bookingPriceSplit.ts`
 * for why that is what keeps totals counting the booking once.
 *
 * Bare, like every flights router (ADR 0001). A satellite of the frozen
 * flights.ts, mounted at the same prefix.
 */

const router = Router();
router.use("/:id/booking", authenticate, requireWriteScope);

const SPLIT_REFUSAL_STATUS: Record<SplitRefusalCode, number> = {
  BOOKING_PRICE_MISSING: 409,
  BOOKING_SPLIT_SINGLE_SEGMENT: 409,
  BOOKING_SPLIT_MIXED: 409,
  BOOKING_SPLIT_DISTANCE_UNKNOWN: 422,
};

async function bookingRow(userId: string, bookingId: string) {
  return prisma.booking.findFirst({
    where: { id: bookingId, userId },
    select: {
      id: true,
      pnr: true,
      price: true,
      currency: true,
      // The trip the BOOKING hangs on — where its price is edited. Not the
      // flight's trip: segments can move to another trip while the booking
      // stays (review I4).
      tripId: true,
      trip: { select: { name: true } },
      priceSplit: true,
      _count: { select: { cruises: true, railJourneys: true, lodgingStays: true } },
    },
  });
}

async function segmentRows(userId: string, bookingId: string) {
  return prisma.flight.findMany({
    where: { userId, bookingId },
    orderBy: [{ departureTime: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  });
}

/**
 * The segments a split shares the total between: a cancelled flight costs
 * nothing (the cost contract, forgejo#274), so it takes no share (review M2).
 */
function payingSegments<T extends { status: string }>(segments: T[]): T[] {
  return segments.filter((s) => s.status !== "cancelled");
}

/** The answer GET, PUT and DELETE all give: the booking as it is now, and its segments. */
async function bookingAnswer(userId: string, bookingId: string | null) {
  if (!bookingId) return { booking: null, segments: [] };
  const row = await bookingRow(userId, bookingId);
  if (!row) return { booking: null, segments: [] };
  const segments = await segmentRows(userId, bookingId);
  const { _count, priceSplit, trip, ...booking } = row;
  return {
    booking: {
      ...booking,
      tripName: trip?.name ?? null,
      otherEntries: _count.cruises + _count.railJourneys + _count.lodgingStays,
      split: readBookingSplit(
        priceSplit,
        booking,
        payingSegments(segments).map((s) => s.id)
      ),
    },
    segments: await enrichFlightsForClients(segments),
  };
}

/** The caller's flight's booking id, or 404 for a flight that is not theirs. */
async function ownBookingId(userId: string, flightId: string): Promise<string | null> {
  const flight = await prisma.flight.findFirst({
    where: { id: flightId, userId },
    select: { bookingId: true },
  });
  if (!flight) throw new AppError("Flight not found", 404, "FLIGHT_NOT_FOUND");
  return flight.bookingId;
}

router.get("/:id/booking", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    res.json(await bookingAnswer(userId, await ownBookingId(userId, req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/booking/split", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const bookingId = await ownBookingId(userId, req.params.id);
    const { method } = bookingSplitBodySchema.parse(req.body);
    const row = bookingId ? await bookingRow(userId, bookingId) : null;
    if (!bookingId || !row) {
      throw new AppError("This flight belongs to no booking", 404, "BOOKING_NOT_FOUND");
    }
    const segments = await segmentRows(userId, bookingId);
    const outcome = computeBookingSplit(
      {
        price: row.price,
        currency: row.currency,
        otherEntries: row._count.cruises + row._count.railJourneys + row._count.lodgingStays,
      },
      payingSegments(segments),
      method
    );
    if ("refusal" in outcome) {
      throw new AppError(
        "The booking price cannot be split this way",
        SPLIT_REFUSAL_STATUS[outcome.refusal],
        outcome.refusal
      );
    }
    await prisma.booking.update({
      where: { id: bookingId },
      data: { priceSplit: outcome.split as unknown as Prisma.InputJsonValue },
    });
    res.json(await bookingAnswer(userId, bookingId));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/booking/split", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const bookingId = await ownBookingId(userId, req.params.id);
    if (!bookingId) {
      throw new AppError("This flight belongs to no booking", 404, "BOOKING_NOT_FOUND");
    }
    // Idempotent: dropping a split that is not there answers the same booking.
    await prisma.booking.updateMany({
      where: { id: bookingId, userId },
      data: { priceSplit: Prisma.DbNull },
    });
    res.json(await bookingAnswer(userId, bookingId));
  } catch (err) {
    next(err);
  }
});

export default router;
