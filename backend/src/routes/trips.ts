import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  createTripSchema,
  updateTripSchema,
  assignFlightsSchema,
  createBookingSchema,
  TRIP_COLORS,
} from "../schemas/trip";
import logger from "../utils/logger";
import { detectTrips } from "../services/tripDetectionService";

const router = Router();

const detectTripsSchema = z.object({
  dryRun: z.boolean().optional().default(true),
});

/**
 * POST /trips/detect — run heuristic auto-detection over the user's
 * trip-less flights. See `services/tripDetectionService.ts` for the
 * heuristic stack. Default `dryRun: true` returns proposals without
 * committing; set `dryRun: false` to atomically create trips and link
 * flights. Always cleans up orphan trips at the end of a non-dry run.
 */
router.post(
  "/trips/detect",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const { dryRun } = detectTripsSchema.parse(req.body ?? {});
      const result = await detectTrips({ userId, dryRun });
      logger.info({
        operation: "trips_detect",
        message: `Trip detection ${dryRun ? "dry-run" : "committed"}`,
        context: {
          userId,
          dryRun,
          proposed: result.proposed.length,
          created: result.created.length,
          orphansRemoved: result.orphansRemoved,
        },
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** GET /trips — list all trips for the current user */
router.get("/trips", authenticate, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const trips = await prisma.trip.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 500, // safety cap — users are unlikely to have more than 500 trips
      include: {
        _count: { select: { flights: true } },
        bookings: { select: { id: true, pnr: true, price: true, currency: true } },
        flights: {
          select: {
            id: true,
            depIata: true,
            arrIata: true,
            departureTime: true,
            arrivalTime: true,
            depLat: true,
            depLon: true,
            arrLat: true,
            arrLon: true,
          },
          orderBy: { departureTime: "asc" },
          take: 200, // cap nested flights per trip — use GET /trips/:id for full flight list
        },
      },
    });
    res.json({ trips });
  } catch (error) {
    next(error);
  }
});

/** POST /trips/bookings — create a booking (must come before /trips/:id) */
router.post("/trips/bookings", authenticate, requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const body = createBookingSchema.parse(req.body);

    if (body.tripId) {
      const trip = await prisma.trip.findFirst({ where: { id: body.tripId, userId } });
      if (!trip) throw new AppError("Trip not found", 404);
    }

    const booking = await prisma.booking.create({
      data: {
        userId,
        tripId: body.tripId ?? null,
        pnr: body.pnr ?? null,
        price: body.price ?? null,
        currency: body.currency ?? "EUR",
      },
    });

    if (body.flightIds && body.flightIds.length > 0) {
      await prisma.flight.updateMany({
        where: { id: { in: body.flightIds }, userId },
        data: {
          bookingId: booking.id,
          ...(body.tripId ? { tripId: body.tripId } : {}),
        },
      });
    }

    res.status(201).json({ booking });
  } catch (error) {
    next(error);
  }
});

/** GET /trips/:id */
router.get("/trips/:id", authenticate, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const trip = await prisma.trip.findFirst({
      where: { id: req.params.id, userId },
      include: {
        bookings: true,
        flights: { orderBy: { departureTime: "asc" } },
      },
    });
    if (!trip) throw new AppError("Trip not found", 404);
    res.json({ trip });
  } catch (error) {
    next(error);
  }
});

/** POST /trips */
router.post("/trips", authenticate, requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const body = createTripSchema.parse(req.body);

    let color = body.color;
    if (!color) {
      const count = await prisma.trip.count({ where: { userId } });
      color = TRIP_COLORS[count % TRIP_COLORS.length];
    }

    const trip = await prisma.trip.create({
      data: { userId, name: body.name, description: body.description, color },
    });

    logger.info({ tripId: trip.id, userId }, "[Trips] Created trip");
    res.status(201).json({ trip });
  } catch (error) {
    next(error);
  }
});

/** PATCH /trips/:id */
router.patch("/trips/:id", authenticate, requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const existing = await prisma.trip.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError("Trip not found", 404);

    const body = updateTripSchema.parse(req.body);
    const trip = await prisma.trip.update({
      where: { id: req.params.id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.color !== undefined && { color: body.color }),
      },
    });

    res.json({ trip });
  } catch (error) {
    next(error);
  }
});

/** DELETE /trips/:id */
router.delete("/trips/:id", authenticate, requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const existing = await prisma.trip.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) throw new AppError("Trip not found", 404);

    await prisma.trip.delete({ where: { id: req.params.id } });
    logger.info({ tripId: req.params.id, userId }, "[Trips] Deleted trip");
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/** POST /trips/:id/flights — assign/unassign flights */
router.post("/trips/:id/flights", authenticate, requireWriteScope, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const trip = await prisma.trip.findFirst({ where: { id: req.params.id, userId } });
    if (!trip) throw new AppError("Trip not found", 404);

    const { flightIds, action } = assignFlightsSchema.parse(req.body);

    const flights = await prisma.flight.findMany({
      where: { id: { in: flightIds }, userId },
      select: { id: true },
    });
    if (flights.length !== flightIds.length) {
      throw new AppError("One or more flights not found", 404);
    }

    if (action === "add") {
      await prisma.flight.updateMany({
        where: { id: { in: flightIds }, userId },
        data: { tripId: trip.id },
      });
    } else {
      await prisma.flight.updateMany({
        where: { id: { in: flightIds }, userId, tripId: trip.id },
        data: { tripId: null },
      });
    }

    res.json({ message: `Flights ${action === "add" ? "added to" : "removed from"} trip` });
  } catch (error) {
    next(error);
  }
});

export default router;
