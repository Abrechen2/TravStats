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
  createStopSchema,
  updateStopSchema,
  createJournalSchema,
  updateJournalSchema,
  TRIP_COLORS,
} from "../schemas/trip";
import logger from "../utils/logger";
import { detectTrips } from "../services/tripDetectionService";

const router = Router();

const reviewProposalSchema = z.object({
  flightIds: z.array(z.string().uuid()).min(2),
  name: z.string().min(1).max(200),
  pnr: z.string().max(20).nullable().optional(),
  source: z.enum(["pnr", "home_loop", "continuity"]).optional(),
});

const detectTripsSchema = z.object({
  dryRun: z.boolean().optional().default(true),
  // Review-flow override: when provided in commit mode (dryRun=false),
  // commit only these proposals with their (possibly renamed) names.
  selectedProposals: z.array(reviewProposalSchema).optional(),
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
      const { dryRun, selectedProposals } = detectTripsSchema.parse(req.body ?? {});
      const result = await detectTrips({ userId, dryRun, selectedProposals });
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
        _count: { select: { flights: true, cruises: true } },
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
        cruises: {
          select: {
            id: true,
            cruiseLine: true,
            startDate: true,
            endDate: true,
            status: true,
            shipId: true,
          },
          orderBy: { startDate: "asc" },
          take: 200,
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
        cruises: {
          include: {
            ship: true,
            departurePort: true,
            arrivalPort: true,
            stops: { include: { port: true }, orderBy: { dayNumber: "asc" } },
          },
          orderBy: { startDate: "asc" },
        },
        stops: { orderBy: [{ orderIdx: "asc" }, { startDate: "asc" }] },
        journalEntries: { orderBy: { date: "asc" } },
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
      data: {
        userId,
        name: body.name,
        description: body.description,
        color,
        startDate: body.startDate,
        endDate: body.endDate,
        status: body.status,
        category: body.category,
        tags: body.tags,
        companions: body.companions,
        notes: body.notes,
        summary: body.summary,
        originLabel: body.originLabel,
        destinationLabel: body.destinationLabel,
        coverImageUrl: body.coverImageUrl,
        icon: body.icon,
        countries: body.countries,
      },
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
        ...(body.startDate !== undefined && { startDate: body.startDate }),
        ...(body.endDate !== undefined && { endDate: body.endDate }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.tags !== undefined && { tags: body.tags }),
        ...(body.companions !== undefined && { companions: body.companions }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.summary !== undefined && { summary: body.summary }),
        ...(body.originLabel !== undefined && { originLabel: body.originLabel }),
        ...(body.destinationLabel !== undefined && { destinationLabel: body.destinationLabel }),
        ...(body.coverImageUrl !== undefined && { coverImageUrl: body.coverImageUrl }),
        ...(body.icon !== undefined && { icon: body.icon }),
        ...(body.countries !== undefined && { countries: body.countries }),
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

/* ─────────── Stops ─────────── */

/** Resolve and authorise a trip by id from the URL — used for every
 *  stop / journal sub-route. Throws 404 if the user doesn't own it. */
async function resolveTrip(userId: string, tripId: string): Promise<{ id: string }> {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, userId }, select: { id: true } });
  if (!trip) throw new AppError("Trip not found", 404);
  return trip;
}

/** POST /trips/:id/stops */
router.post(
  "/trips/:id/stops",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const body = createStopSchema.parse(req.body);
      const stop = await prisma.tripStop.create({
        data: {
          tripId: trip.id,
          title: body.title,
          domain: body.domain,
          sourceId: body.sourceId,
          description: body.description,
          startDate: body.startDate,
          endDate: body.endDate,
          lat: body.lat,
          lon: body.lon,
          notes: body.notes,
          orderIdx: body.orderIdx ?? 0,
        },
      });
      res.status(201).json({ stop });
    } catch (error) {
      next(error);
    }
  },
);

/** PATCH /trips/:id/stops/:stopId */
router.patch(
  "/trips/:id/stops/:stopId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const existing = await prisma.tripStop.findFirst({
        where: { id: req.params.stopId, tripId: req.params.id },
      });
      if (!existing) throw new AppError("Stop not found", 404);
      const body = updateStopSchema.parse(req.body);
      const stop = await prisma.tripStop.update({
        where: { id: req.params.stopId },
        data: {
          ...(body.title !== undefined && { title: body.title }),
          ...(body.domain !== undefined && { domain: body.domain }),
          ...(body.sourceId !== undefined && { sourceId: body.sourceId }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.startDate !== undefined && { startDate: body.startDate }),
          ...(body.endDate !== undefined && { endDate: body.endDate }),
          ...(body.lat !== undefined && { lat: body.lat }),
          ...(body.lon !== undefined && { lon: body.lon }),
          ...(body.notes !== undefined && { notes: body.notes }),
          ...(body.orderIdx !== undefined && { orderIdx: body.orderIdx }),
        },
      });
      res.json({ stop });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /trips/:id/stops/:stopId */
router.delete(
  "/trips/:id/stops/:stopId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const existing = await prisma.tripStop.findFirst({
        where: { id: req.params.stopId, tripId: req.params.id },
      });
      if (!existing) throw new AppError("Stop not found", 404);
      await prisma.tripStop.delete({ where: { id: req.params.stopId } });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

/* ─────────── Journal entries ─────────── */

/** POST /trips/:id/journal */
router.post(
  "/trips/:id/journal",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await resolveTrip(userId, req.params.id);
      const body = createJournalSchema.parse(req.body);
      const entry = await prisma.tripJournalEntry.create({
        data: {
          tripId: trip.id,
          date: body.date,
          title: body.title,
          body: body.body,
          mood: body.mood,
          weather: body.weather,
        },
      });
      res.status(201).json({ entry });
    } catch (error) {
      next(error);
    }
  },
);

/** PATCH /trips/:id/journal/:entryId */
router.patch(
  "/trips/:id/journal/:entryId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const existing = await prisma.tripJournalEntry.findFirst({
        where: { id: req.params.entryId, tripId: req.params.id },
      });
      if (!existing) throw new AppError("Journal entry not found", 404);
      const body = updateJournalSchema.parse(req.body);
      const entry = await prisma.tripJournalEntry.update({
        where: { id: req.params.entryId },
        data: {
          ...(body.date !== undefined && { date: body.date }),
          ...(body.title !== undefined && { title: body.title }),
          ...(body.body !== undefined && { body: body.body }),
          ...(body.mood !== undefined && { mood: body.mood }),
          ...(body.weather !== undefined && { weather: body.weather }),
        },
      });
      res.json({ entry });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /trips/:id/journal/:entryId */
router.delete(
  "/trips/:id/journal/:entryId",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const existing = await prisma.tripJournalEntry.findFirst({
        where: { id: req.params.entryId, tripId: req.params.id },
      });
      if (!existing) throw new AppError("Journal entry not found", 404);
      await prisma.tripJournalEntry.delete({ where: { id: req.params.entryId } });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
