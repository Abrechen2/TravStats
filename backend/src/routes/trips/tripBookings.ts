/**
 * Bookings — one payment covering several things, the flight and the hotel on
 * one reference. Split out of `routes/trips.ts` (which sat at the 800-line
 * limit) when #356 added the two links a booking was missing: moving it onto
 * a trip after the fact, and filing existing flights on it.
 *
 * #356 then made a package booking something a user can build by hand on the
 * trip page: an operator, a traveller count ("für N Personen"), the day it
 * was booked (which dates its FX snapshot), and the full set of flights,
 * stays and cruises it covers (`PUT …/entries`), plus deleting one.
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
import {
  bookingEntriesSchema,
  bookingFlightsSchema,
  createBookingSchema,
  updateBookingSchema,
} from "../../schemas/trip";
import { recomputeTripStatus } from "../../services/tripStatusService";
import { fxColumnsFor, getBaseCurrency } from "../../services/fx/snapshot";
import { propagateWrites, shareSnapshots } from "../../services/sharing/propagate";
import { bookingFxDay, setBookingEntries } from "../../services/trip/bookingEntries";

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

      // FX snapshot (#267), dated by the day the booking was made (#356) —
      // the package import already used the document's issue day. Only a
      // booking that names no day falls back to the day it was recorded.
      const bookingCurrency = body.currency ?? "EUR";
      const bookingFx = await fxColumnsFor(
        {
          amount: body.price ?? null,
          currency: bookingCurrency,
          date: bookingFxDay(body.bookedOn ?? null, new Date()),
        },
        await getBaseCurrency(userId)
      );

      const booking = await prisma.$transaction(async (tx) => {
        const created = await tx.booking.create({
          data: {
            userId,
            tripId: body.tripId ?? null,
            pnr: body.pnr ?? null,
            price: body.price ?? null,
            currency: bookingCurrency,
            operator: body.operator ?? null,
            travellers: body.travellers ?? null,
            bookedOn: body.bookedOn ?? null,
            ...bookingFx,
          },
        });
        // All or nothing: one entry that is not the caller's refuses the
        // booking too, so a half-filed package never exists.
        // `moveToTrip`: entries named at creation move onto the booking's
        // trip, as flights always did here.
        await setBookingEntries(
          tx,
          userId,
          created,
          { flightIds: body.flightIds, stayIds: body.stayIds, cruiseIds: body.cruiseIds },
          { moveToTrip: true }
        );
        return created;
      });
      if (booking.tripId) await recomputeTripStatus(booking.tripId);

      res.status(201).json({ booking });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /trips/bookings/:id — edit pnr/price/currency/operator/travellers/
 * booking day, and (#356) the trip it belongs to. Never touches the booking's
 * entries: their prices stay whatever they are, and they stay on whatever trip
 * they are on — moving a booking is not moving every entry it paid for.
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
      if (body.operator !== undefined) data.operator = body.operator;
      if (body.travellers !== undefined) data.travellers = body.travellers;
      if (body.bookedOn !== undefined) data.bookedOn = body.bookedOn;

      // Re-snapshot only when the amount, its unit or its day actually moved (#267).
      if (body.price !== undefined || body.currency !== undefined || body.bookedOn !== undefined) {
        const bookedOn = body.bookedOn !== undefined ? body.bookedOn : existing.bookedOn;
        Object.assign(
          data,
          await fxColumnsFor(
            {
              amount: body.price !== undefined ? body.price : existing.price,
              currency: body.currency !== undefined ? body.currency : existing.currency,
              date: bookingFxDay(bookedOn, existing.createdAt),
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
 * PUT /trips/bookings/:id/entries — the flights, stays and cruises this
 * booking covers (#356). Each list given replaces that kind's set; an entry
 * the trip does not hold yet joins the booking's trip. One id that is not the
 * caller's refuses the call and changes nothing.
 */
router.put(
  "/trips/bookings/:id/entries",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const lists = bookingEntriesSchema.parse(req.body);
      const booking = await prisma.booking.findFirst({
        where: { id: req.params.id, userId },
        select: { id: true, tripId: true },
      });
      if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");

      const counts = await prisma.$transaction((tx) =>
        setBookingEntries(tx, userId, booking, lists, { replace: true })
      );
      if (booking.tripId) await recomputeTripStatus(booking.tripId);
      res.json({ bookingId: booking.id, ...counts });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /trips/bookings/:id — the booking goes, its entries stay: every
 * flight, stay and cruise it covered keeps its own row and its own price and
 * simply belongs to no booking any more (FK `onDelete: SetNull`).
 */
router.delete(
  "/trips/bookings/:id",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const booking = await prisma.booking.findFirst({
        where: { id: req.params.id, userId },
        select: { id: true, tripId: true },
      });
      if (!booking) throw new AppError("Booking not found", 404, "BOOKING_NOT_FOUND");
      await prisma.$transaction(async (tx) => {
        await setBookingEntries(
          tx,
          userId,
          booking,
          { flightIds: [], stayIds: [], cruiseIds: [] },
          { replace: true }
        );
        await tx.booking.delete({ where: { id: booking.id } });
      });
      if (booking.tripId) await recomputeTripStatus(booking.tripId);
      res.status(204).send();
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
