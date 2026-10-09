import { Router, Response, NextFunction } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { enrichFlightsForClients } from "../../services/flightAirportFacts";

/**
 * `GET /api/v1/flights/:id/booking` — the booking a flight belongs to and
 * every flight segment of it (forgejo#218).
 *
 * Only flights LINKED to the same booking (`bookingId`) come back. Two
 * flights that merely share a PNR string are not a booking until something
 * linked them; reading them as one would merge what nobody merged
 * ("nicht verknüpfte Buchungen werden nicht ungefragt zusammengelegt").
 *
 * Segments are ordered by their stored departure instant, then id, so the
 * answer is stable. That order is the SERVER's; whether two segments' order
 * is actually known (a day-only departure) is the web's judgement, made on
 * the `times` each segment carries.
 *
 * Bare, like every flights router (ADR 0001). A satellite of the frozen
 * flights.ts, mounted at the same prefix.
 */

const router = Router();
router.use("/:id/booking", authenticate, requireWriteScope);

/** The booking facts a flight's page explains, plus how many non-flight entries share it. */
export async function bookingView(userId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    select: {
      id: true,
      pnr: true,
      price: true,
      currency: true,
      _count: { select: { cruises: true, railJourneys: true, lodgingStays: true } },
    },
  });
  if (!booking) return null;
  const { _count, ...rest } = booking;
  return {
    ...rest,
    otherEntries: _count.cruises + _count.railJourneys + _count.lodgingStays,
  };
}

export async function bookingSegments(userId: string, bookingId: string) {
  const rows = await prisma.flight.findMany({
    where: { userId, bookingId },
    orderBy: [{ departureTime: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  });
  return enrichFlightsForClients(rows);
}

router.get("/:id/booking", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const flight = await prisma.flight.findFirst({
      where: { id: req.params.id, userId },
      select: { bookingId: true },
    });
    if (!flight) throw new AppError("Flight not found", 404, "FLIGHT_NOT_FOUND");
    if (!flight.bookingId) {
      res.json({ booking: null, segments: [] });
      return;
    }
    const booking = await bookingView(userId, flight.bookingId);
    if (!booking) {
      res.json({ booking: null, segments: [] });
      return;
    }
    res.json({ booking, segments: await bookingSegments(userId, flight.bookingId) });
  } catch (err) {
    next(err);
  }
});

export default router;
