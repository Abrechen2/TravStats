/**
 * Bookings — one payment covering several things, the flight and the hotel on
 * one reference. Split out of `routes/trips.ts` (which sat at the 800-line
 * limit) when #356 added the two links a booking was missing: moving it onto
 * a trip after the fact, and filing existing flights on it.
 *
 * Mounted BEFORE `trips`, at the same base, so `/trips/bookings` is never read
 * as a trip id — the order the routes had while they lived in trips.ts.
 * Bare response family, like trips.ts (ADR 0001).
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { bookingFlightsSchema, createBookingSchema, updateBookingSchema } from "../../schemas/trip";
import { recomputeTripStatus } from "../../services/tripStatusService";
import { fxColumnsFor, getBaseCurrency } from "../../services/fx/snapshot";
import { propagateWrites, shareSnapshots } from "../../services/sharing/propagate";

const router = Router();

/** The caller's trip, or 404 — a stranger's trip is not a trip (AUD-038). */
async function assertOwnTrip(userId: string, tripId: string): Promise<void> {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, userId }, select: { id: true } });
  if (!trip) throw new AppError("Trip not found", 404, "TRIP_NOT_FOUND", "tripId");
}

/** POST /trips/bookings — create a booking (must come before /trips/:id) */
router.post(
  "/trips/bookings",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const body = createBookingSchema.parse(req.body);

      if (body.tripId) await assertOwnTrip(userId, body.tripId);

      // FX snapshot (#267). A booking carries no travel date of its own, so the
      // rate is taken for the day it was recorded. That is the only day it has,
      // and it is honest as long as it is stored alongside the rate rather than
      // implied.
      const bookingCurrency = body.currency ?? "EUR";
      const bookingFx = await fxColumnsFor(
        { amount: body.price ?? null, currency: bookingCurrency, date: new Date() },
        await getBaseCurrency(userId)
      );

      const booking = await prisma.booking.create({
        data: {
          userId,
          tripId: body.tripId ?? null,
          pnr: body.pnr ?? null,
          price: body.price ?? null,
          currency: bookingCurrency,
          ...bookingFx,
        },
      });

      if (body.flightIds && body.flightIds.length > 0) {
        const before = await shareSnapshots(prisma, "flight", body.flightIds);
        await prisma.flight.updateMany({
          where: { id: { in: body.flightIds }, userId },
          data: {
            bookingId: booking.id,
            ...(body.tripId ? { tripId: body.tripId } : {}),
          },
        });
        await propagateWrites(prisma, userId, "flight", body.flightIds, before);
        if (body.tripId) {
          await recomputeTripStatus(body.tripId);
        }
      }

      res.status(201).json({ booking });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /trips/bookings/:id — edit pnr/price/currency, and (#356) the trip it
 * belongs to. Never touches the booking's flights: their prices stay whatever
 * they are, and they stay on whatever trip they are on — moving a booking is
 * not moving every entry it paid for.
 */
router.patch(
  "/trips/bookings/:id",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const body = updateBookingSchema.parse(req.body);

      const existing = await prisma.booking.findFirst({
        where: { id: req.params.id, userId },
      });
      if (!existing) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
      if (body.tripId) await assertOwnTrip(userId, body.tripId);

      const data: Prisma.BookingUncheckedUpdateInput = {};
      if (body.pnr !== undefined) data.pnr = body.pnr;
      if (body.price !== undefined) data.price = body.price;
      if (body.currency !== undefined) data.currency = body.currency;
      if (body.tripId !== undefined) data.tripId = body.tripId;

      // Re-snapshot only when the amount or its unit actually moved (#267).
      if (body.price !== undefined || body.currency !== undefined) {
        Object.assign(
          data,
          await fxColumnsFor(
            {
              amount: body.price !== undefined ? body.price : existing.price,
              currency: body.currency !== undefined ? body.currency : existing.currency,
              date: existing.createdAt,
            },
            await getBaseCurrency(userId)
          )
        );
      }

      const booking = await prisma.booking.update({
        where: { id: existing.id },
        data,
      });
      res.json({ booking });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /trips/bookings/:id/flights — file existing flights on a booking
 * (#356). A flight the booking's trip does not hold yet joins it; one already
 * on another trip keeps that trip, because a booking says who paid, not where
 * the user grouped the journey. All or nothing: one id that is not the
 * caller's refuses the call and files none.
 */
router.post(
  "/trips/bookings/:id/flights",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const { flightIds } = bookingFlightsSchema.parse(req.body);
      const booking = await prisma.booking.findFirst({
        where: { id: req.params.id, userId },
        select: { id: true, tripId: true },
      });
      if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

      const unique = [...new Set(flightIds)];
      const owned = await prisma.flight.count({ where: { id: { in: unique }, userId } });
      if (owned !== unique.length) {
        throw new AppError("Flight not found", 404, "FLIGHT_NOT_FOUND", "flightIds");
      }

      const count = await prisma.$transaction(async (tx) => {
        const before = await shareSnapshots(tx, "flight", unique);
        const filed = await tx.flight.updateMany({
          where: { id: { in: unique }, userId },
          data: { bookingId: booking.id },
        });
        if (booking.tripId) {
          await tx.flight.updateMany({
            where: { id: { in: unique }, userId, tripId: null },
            data: { tripId: booking.tripId },
          });
        }
        await propagateWrites(tx, userId, "flight", unique, before);
        return filed.count;
      });
      if (booking.tripId) await recomputeTripStatus(booking.tripId);

      res.json({ bookingId: booking.id, count });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
