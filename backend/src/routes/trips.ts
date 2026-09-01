import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { Prisma } from "@prisma/client";
import {
  authenticate,
  requireWriteScope,
  AuthRequest,
} from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  createTripSchema,
  updateTripSchema,
  assignFlightsSchema,
  createBookingSchema,
  updateBookingSchema,
  createStopSchema,
  updateStopSchema,
  createJournalSchema,
  updateJournalSchema,
  TRIP_COLORS,
} from "../schemas/trip";
import logger from "../utils/logger";
import { resolveCompanions, linkRowsFor } from "../services/companionService";
import { deriveTripStatus } from "../shared/statusDerivation";
import { isoCountryCode } from "../utils/continents";

import { detectTrips } from "../services/tripDetectionService";
import { recomputeTripStatus } from "../services/tripStatusService";
import {
  findMicroTripCandidates,
  dissolveMicroTrips,
  mergeTrips,
} from "../services/tripCleanupService";
import { recomputeLegs } from "../services/tour/legRecompute";
import {
  summariseTrip,
  checkOllamaAvailable,
} from "../services/tripSummaryService";
import { emailParseLimiter, uploadReceiptLimiter } from "../middleware/rateLimit";
import {
  uploadTripPhotos,
  uploadTripCover,
  deleteTripPhotoFile,
  getTripPhotoDir,
} from "../middleware/upload";
import path from "path";
import fs from "fs";
import { fxColumnsFor, getBaseCurrency } from "../services/fx/snapshot";

/**
 * Airport facts (country + IANA zone) for a trip's flights, keyed by IATA.
 *
 * Two gaps share one lookup. The flight row stores UTC plus time semantics and
 * carries no zone of its own, so rendering each end in ITS airport's clock
 * needs the airport. And `trips.countries` is a stored column nobody derives,
 * while `flights.overflownCountries` is empty for manually created flights —
 * a hand-entered FRA-JFK left the trip reading "0 countries" for a route that
 * plainly spans two. The stored column still wins when the user filled it.
 */
async function airportFactsFor(
  flights: Array<{ depIata: string | null; arrIata: string | null }>,
): Promise<Map<string, { country: string | null; timezone: string | null }>> {
  const codes = [
    ...new Set(
      flights
        .flatMap((f) => [f.depIata, f.arrIata])
        .filter((c): c is string => !!c),
    ),
  ];
  if (codes.length === 0) return new Map();
  const airports = await prisma.airport.findMany({
    where: { iata: { in: codes } },
    select: { iata: true, country: true, timezone: true },
  });
  return new Map(
    airports
      .filter((a): a is typeof a & { iata: string } => !!a.iata)
      .map((a) => [a.iata, { country: a.country, timezone: a.timezone }]),
  );
}

/**
 * Countries of a trip: the stored list when it has one, otherwise derived from
 * the countries its flights touch.
 *
 * `trips.countries` is a column nobody writes, and `overflownCountries` is
 * empty for manually created flights, so without the fallback the tile reads
 * zero for a trip that plainly visited five countries. 2.5.0 added that
 * fallback to GET /trips/:id only — and the LIST endpoint is what feeds the
 * trip cards, so every card on the Reisen overview kept showing "?" next to a
 * detail page showing five. Both call this now; a third caller must too.
 */
function tripCountries(
  stored: string[],
  flights: Array<{ depIata: string | null; arrIata: string | null }>,
  facts: Map<string, { country: string | null; timezone: string | null }>,
  cruiseCountries: string[] = [],
): string[] {
  // A list the user filled in themselves is theirs — returned untouched.
  if (stored.length) return stored;

  const derived = [
    ...flights
      .flatMap((f) => [f.depIata, f.arrIata])
      .map((code) => (code ? facts.get(code)?.country : null))
      .filter((c): c is string => !!c),
    // Cruise-only trips carry no flights at all, so a flight-only derivation
    // left them reading "?" for a voyage that plainly called at six countries.
    // Their countries come from the ports they visited.
    ...cruiseCountries,
  ];

  // The two catalogues speak different languages — airports store ISO alpha-2,
  // ports store English names — so a trip with BOTH a flight and a cruise to
  // Germany would otherwise carry "DE" and "Germany" and count it twice. Fold
  // to one vocabulary, and keep anything unresolvable under its own name so a
  // country is never silently dropped from the list.
  return [...new Set(derived.map((c) => isoCountryCode(c) ?? c))].sort();
}

/**
 * Countries reached by each trip's cruises, keyed by trip id.
 *
 * One query for every trip on the page rather than one per trip. Covers the
 * itinerary the way the cruise stats do: the port calls, plus the voyage's own
 * departure and arrival ports, which are not always repeated as stops.
 */
async function cruiseCountriesByTrip(tripIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (tripIds.length === 0) return out;

  const cruises = await prisma.cruise.findMany({
    where: { tripId: { in: tripIds } },
    select: {
      tripId: true,
      departurePort: { select: { country: true } },
      arrivalPort: { select: { country: true } },
      stops: { select: { port: { select: { country: true } } } },
    },
  });

  for (const c of cruises) {
    if (!c.tripId) continue;
    const acc = out.get(c.tripId) ?? [];
    for (const country of [
      c.departurePort?.country,
      c.arrivalPort?.country,
      ...c.stops.map((s) => s.port?.country),
    ]) {
      if (country) acc.push(country);
    }
    out.set(c.tripId, acc);
  }
  return out;
}

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
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      const { dryRun, selectedProposals } = detectTripsSchema.parse(
        req.body ?? {},
      );
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
router.get(
  "/trips",
  authenticate,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      const trips = await prisma.trip.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 500, // safety cap — users are unlikely to have more than 500 trips
        include: {
          _count: { select: { flights: true, cruises: true, lodgingStays: true } },
          bookings: {
            select: { id: true, pnr: true, price: true, currency: true },
          },
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
              // Each end must render in ITS airport's zone; without these the
              // trip timeline fell back to the viewer's clock and disagreed
              // with the flights table by the whole UTC offset.
              depTimeSemantics: true,
              arrTimeSemantics: true,
              // A flight that carries its own price (no booking) belongs in the
              // trip total — a hand-entered price used to vanish from it.
              price: true,
              currency: true,
              bookingId: true,
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
              // A cruise carrying its own price belongs in the trip total, on
              // the same rule that applies to flights — without these a
              // cruise-only trip read "— Gesamtkosten" while its cruises had
              // prices on file.
              price: true,
              currency: true,
              bookingId: true,
            },
            orderBy: { startDate: "asc" },
            take: 200,
          },
          // Same rule, third domain: a stay carrying its own price belongs in
          // the trip total. Without this the CARD excluded lodging from the
          // sum while the detail page (full include below) counted it — the
          // exact split the cruise select above was added to close.
          lodgingStays: {
            select: {
              id: true,
              checkIn: true,
              checkOut: true,
              status: true,
              totalPrice: true,
              // Fallback for the total when no totalPrice was typed:
              // per-night × nights, derived on the card.
              pricePerNight: true,
              currency: true,
              bookingId: true,
            },
            orderBy: { checkIn: "asc" },
            take: 200,
          },
        },
      });
      // One batched airport lookup across EVERY trip's flights, not one per
      // trip: the cards need the same country derivation the detail page does,
      // and doing it per trip would turn one page load into N queries.
      // Cruise distance lives on the legs the sea router computed, one row per
      // port-to-port hop. One grouped query over every cruise on the page keeps
      // this at a constant query count, like the airport lookup above.
      const cruiseIds = trips.flatMap((t) => t.cruises.map((c) => c.id));
      const [facts, cruiseCountries, legSums] = await Promise.all([
        airportFactsFor(trips.flatMap((t) => t.flights)),
        cruiseCountriesByTrip(trips.map((t) => t.id)),
        cruiseIds.length > 0
          ? prisma.cruiseLeg.groupBy({
              by: ["cruiseId"],
              where: { cruiseId: { in: cruiseIds } },
              _sum: { distanceKm: true },
            })
          : Promise.resolve([]),
      ]);
      const distanceByCruise = new Map(
        legSums.map((row) => [row.cruiseId, row._sum.distanceKm ?? 0]),
      );
      res.json({
        trips: trips.map((t) => ({
          ...t,
          cruises: t.cruises.map((c) => ({
            ...c,
            distanceKm: Math.round(distanceByCruise.get(c.id) ?? 0),
          })),
          countries: tripCountries(
            t.countries,
            t.flights,
            facts,
            cruiseCountries.get(t.id) ?? [],
          ),
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /trips/bookings — create a booking (must come before /trips/:id) */
router.post(
  "/trips/bookings",
  authenticate,
  requireWriteScope,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      const body = createBookingSchema.parse(req.body);

      if (body.tripId) {
        const trip = await prisma.trip.findFirst({
          where: { id: body.tripId, userId },
        });
        if (!trip) throw new AppError("Trip not found", 404);
      }

      // FX snapshot (#267). A booking carries no travel date of its own, so the
      // rate is taken for the day it was recorded. That is the only day it has,
      // and it is honest as long as it is stored alongside the rate rather than
      // implied.
      const bookingCurrency = body.currency ?? "EUR";
      const bookingFx = await fxColumnsFor(
        { amount: body.price ?? null, currency: bookingCurrency, date: new Date() },
        await getBaseCurrency(userId),
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
        await prisma.flight.updateMany({
          where: { id: { in: body.flightIds }, userId },
          data: {
            bookingId: booking.id,
            ...(body.tripId ? { tripId: body.tripId } : {}),
          },
        });
        if (body.tripId) {
          await recomputeTripStatus(body.tripId);
        }
      }

      res.status(201).json({ booking });
    } catch (error) {
      next(error);
    }
  },
);

/** PATCH /trips/bookings/:id — edit pnr/price/currency. Never touches the
 *  booking's flights (their prices stay whatever they are). */
router.patch(
  "/trips/bookings/:id",
  authenticate,
  requireWriteScope,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      const body = updateBookingSchema.parse(req.body);

      const existing = await prisma.booking.findFirst({
        where: { id: req.params.id, userId },
      });
      if (!existing) throw new AppError("Booking not found", 404);

      const data: Prisma.BookingUpdateInput = {};
      if (body.pnr !== undefined) data.pnr = body.pnr;
      if (body.price !== undefined) data.price = body.price;
      if (body.currency !== undefined) data.currency = body.currency;

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
            await getBaseCurrency(userId),
          ),
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
  },
);

const dissolveTripsSchema = z.object({
  tripIds: z.array(z.string().uuid()).min(1).max(500),
});

const mergeTripsSchema = z.object({
  tripIds: z.array(z.string().uuid()).min(2).max(100),
  name: z.string().min(1).max(200).optional(),
  targetId: z.string().uuid().optional(),
});

/**
 * GET /trips/cleanup/micro — list "micro-trip" candidates: trips that
 * wrap at most 2 flights and carry no other content (no cruises, stops,
 * journal entries, photos, notes). These are typically legacy artifacts
 * of the old per-booking auto-detection. Registered before /trips/:id
 * so "cleanup" is not consumed as an id.
 */
router.get(
  "/trips/cleanup/micro",
  authenticate,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const candidates = await findMicroTripCandidates(req.userId!);
      res.json({ candidates });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /trips/cleanup/dissolve — delete the given micro-trips. Flights
 * and bookings survive (FK onDelete: SetNull); ids are re-validated
 * against the candidate criteria server-side.
 */
router.post(
  "/trips/cleanup/dissolve",
  authenticate,
  requireWriteScope,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { tripIds } = dissolveTripsSchema.parse(req.body);
      const result = await dissolveMicroTrips(req.userId!, tripIds);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /trips/merge — merge several trips into one journey. All linked
 * entities move to the target trip; metadata arrays are unioned; source
 * trips are deleted.
 */
router.post(
  "/trips/merge",
  authenticate,
  requireWriteScope,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = mergeTripsSchema.parse(req.body);
      const result = await mergeTrips(req.userId!, body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/** GET /trips/:id */
router.get(
  "/trips/:id",
  authenticate,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
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
          photos: { orderBy: [{ sortIdx: "asc" }, { createdAt: "asc" }] },
          immichAlbums: { orderBy: { sortIdx: "asc" } },
          // A LodgingStay linked to this trip (StayEditor's tripId picker) —
          // the spec requires it to surface as check-in/check-out entries on
          // the trip timeline (frontend/src/pages/TripDetailPage.tsx), which
          // needs the lodging's name, so `lodging` is always included here.
          lodgingStays: { include: { lodging: true }, orderBy: { checkIn: "asc" } },
        },
      });
      if (!trip) throw new AppError("Trip not found", 404);
      // Map raw photo rows to DTOs (drops internal "__cover__" sentinel
      // photos so the gallery never shows the cover twice).
      const photos = trip.photos
        .filter((p) => p.caption !== "__cover__")
        .map(toPhotoDto);
      // One airport lookup serves two gaps the beta UAT found: the timeline
      // rendered each end in the VIEWER's clock (a JFK arrival read six hours
      // off), and the countries tile stayed at 0 because `trips.countries` is a
      // stored column nobody derives and `overflownCountries` is empty for
      // manually created flights.
      const facts = await airportFactsFor(trip.flights);
      const flights = trip.flights.map((f) => ({
        ...f,
        depTimezone: (f.depIata && facts.get(f.depIata)?.timezone) || null,
        arrTimezone: (f.arrIata && facts.get(f.arrIata)?.timezone) || null,
      }));
      const cruiseCountries = await cruiseCountriesByTrip([trip.id]);
      const countries = tripCountries(
        trip.countries,
        trip.flights,
        facts,
        cruiseCountries.get(trip.id) ?? [],
      );
      res.json({ trip: { ...trip, photos, flights, countries } });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /trips */
router.post(
  "/trips",
  authenticate,
  requireWriteScope,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      const body = createTripSchema.parse(req.body);

      let color = body.color;
      if (!color) {
        const count = await prisma.trip.count({ where: { userId } });
        color = TRIP_COLORS[count % TRIP_COLORS.length];
      }

      // Resolve companion names to Companion entities up front (find-or-create
      // is idempotent via companionService, so it's safe to run outside the
      // transaction below). The trip row and its links are written together
      // inside a transaction so a failure never leaves the legacy `companions`
      // array and the `companionLinks` table disagreeing.
      const companionNames = body.companions ?? [];
      const resolvedCompanions = await resolveCompanions(
        userId,
        companionNames,
      );

      const trip = await prisma.$transaction(async (tx) => {
        const created = await tx.trip.create({
          data: {
            userId,
            name: body.name,
            description: body.description,
            color,
            startDate: body.startDate,
            endDate: body.endDate,
            // Status derivation (spec 2026-07-17-status-from-dates) normally
            // reads linked flights/cruises, which cannot exist yet — a trip must
            // exist before anything can reference its id. Falling through to the
            // column default meant every hand-made trip was born "completed",
            // including one starting next week; the dates the user had just
            // typed were never consulted. So when no segments exist, derive from
            // the trip's OWN bounds. recomputeTripStatus() still takes over the
            // moment segments get linked (assign-flights, bookings link, PNR
            // auto-trip creation, trip detection).
            status:
              body.status ??
              deriveTripStatus({
                earliestStart: body.startDate ?? null,
                latestEnd: body.endDate ?? null,
              }) ??
              undefined,
            category: body.category,
            tags: body.tags,
            // Dual write: resolved display names keep this legacy array in
            // agreement with `companionLinks` below (trimmed, blanks dropped,
            // newest spelling wins) — the previous image still reads this column.
            companions: resolvedCompanions.map((c) => c.displayName),
            notes: body.notes,
            summary: body.summary,
            originLabel: body.originLabel,
            destinationLabel: body.destinationLabel,
            coverImageUrl: body.coverImageUrl,
            icon: body.icon,
            countries: body.countries,
          },
        });

        if (resolvedCompanions.length > 0) {
          await tx.tripCompanion.createMany({
            data: linkRowsFor(resolvedCompanions.map((c) => c.id)).map(
              (row) => ({
                ...row,
                tripId: created.id,
              }),
            ),
            skipDuplicates: true,
          });
        }

        return created;
      });

      logger.info({ tripId: trip.id, userId }, "[Trips] Created trip");
      res.status(201).json({ trip });
    } catch (error) {
      next(error);
    }
  },
);

/** PATCH /trips/:id */
router.patch(
  "/trips/:id",
  authenticate,
  requireWriteScope,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      const existing = await prisma.trip.findFirst({
        where: { id: req.params.id, userId },
      });
      if (!existing) throw new AppError("Trip not found", 404);

      const body = updateTripSchema.parse(req.body);

      // Status derivation (spec 2026-07-17-status-from-dates): the schema
      // still ACCEPTS `status` for API compat (never a 400), but the route
      // ignores it — status is derived from segment dates, never set
      // directly. A stale client sending its own guess must not fight
      // recomputeTripStatus()/the sweep on every save.
      if (body.status !== undefined) {
        logger.debug({
          operation: "trip_status_field_ignored",
          message: "PATCH /trips/:id ignored a client-sent status field",
          context: { tripId: req.params.id, requestedStatus: body.status },
        });
      }

      // Replace rather than append — an update always carries the FULL
      // companion list for the trip, so stale links must go. Resolution
      // itself (find-or-create against Companion) is idempotent and safe to
      // run here, outside any transaction — same reasoning as the create
      // handler. The actual link replacement is deferred and run together
      // with the `trip.update` call below inside one `prisma.$transaction`,
      // so a failure between the two never leaves the legacy array and
      // `companionLinks` disagreeing (undefined here means "untouched": the
      // companions field was not part of this update at all).
      let resolvedCompanionsForUpdate:
        { id: string; displayName: string }[] | undefined;
      if (body.companions !== undefined) {
        resolvedCompanionsForUpdate = await resolveCompanions(
          userId,
          body.companions,
        );
      }

      const trip = await prisma.$transaction(async (tx) => {
        if (resolvedCompanionsForUpdate !== undefined) {
          await tx.tripCompanion.deleteMany({ where: { tripId: existing.id } });
          if (resolvedCompanionsForUpdate.length > 0) {
            await tx.tripCompanion.createMany({
              data: linkRowsFor(
                resolvedCompanionsForUpdate.map((c) => c.id),
              ).map((row) => ({
                ...row,
                tripId: existing.id,
              })),
              skipDuplicates: true,
            });
          }
        }

        return tx.trip.update({
          where: { id: req.params.id },
          data: {
            ...(body.name !== undefined && { name: body.name }),
            ...(body.description !== undefined && {
              description: body.description,
            }),
            ...(body.color !== undefined && { color: body.color }),
            ...(body.startDate !== undefined && { startDate: body.startDate }),
            ...(body.endDate !== undefined && { endDate: body.endDate }),
            ...(body.category !== undefined && { category: body.category }),
            ...(body.tags !== undefined && { tags: body.tags }),
            ...(resolvedCompanionsForUpdate !== undefined && {
              companions: resolvedCompanionsForUpdate.map((c) => c.displayName),
            }),
            ...(body.notes !== undefined && { notes: body.notes }),
            ...(body.summary !== undefined && { summary: body.summary }),
            ...(body.originLabel !== undefined && {
              originLabel: body.originLabel,
            }),
            ...(body.destinationLabel !== undefined && {
              destinationLabel: body.destinationLabel,
            }),
            ...(body.coverImageUrl !== undefined && {
              coverImageUrl: body.coverImageUrl,
            }),
            ...(body.icon !== undefined && { icon: body.icon }),
            ...(body.countries !== undefined && { countries: body.countries }),
          },
        });
      });

      res.json({ trip });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /trips/:id */
router.delete(
  "/trips/:id",
  authenticate,
  requireWriteScope,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      const existing = await prisma.trip.findFirst({
        where: { id: req.params.id, userId },
      });
      if (!existing) throw new AppError("Trip not found", 404);

      await prisma.trip.delete({ where: { id: req.params.id } });
      logger.info({ tripId: req.params.id, userId }, "[Trips] Deleted trip");
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

/** POST /trips/:id/flights — assign/unassign flights */
router.post(
  "/trips/:id/flights",
  authenticate,
  requireWriteScope,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      const trip = await prisma.trip.findFirst({
        where: { id: req.params.id, userId },
      });
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

      await recomputeTripStatus(trip.id);

      res.json({
        message: `Flights ${action === "add" ? "added to" : "removed from"} trip`,
      });
    } catch (error) {
      next(error);
    }
  },
);

/* ─────────── Stops ─────────── */

/** Resolve and authorise a trip by id from the URL — used for every
 *  stop / journal sub-route. Throws 404 if the user doesn't own it. */
export async function resolveTrip(
  userId: string,
  tripId: string,
): Promise<{ id: string }> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: { id: true },
  });
  if (!trip) throw new AppError("Trip not found", 404);
  return trip;
}

/** POST /trips/:id/stops */
router.post(
  "/trips/:id/stops",
  authenticate,
  requireWriteScope,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
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
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const existing = await prisma.tripStop.findFirst({
        where: { id: req.params.stopId, tripId: req.params.id },
      });
      if (!existing) throw new AppError("Stop not found", 404);
      const body = updateStopSchema.parse(req.body);
      // A route member's coordinates are the invariant a section's legs
      // are built on (`recomputeLegs` refuses a coordinate-less endpoint
      // at assignment time) — but `lat`/`lon` stay nullable on the stop
      // itself, and this endpoint would otherwise silently null them out
      // from under an assigned leg. Enforced here, at the ONLY other write
      // path for a stop's coordinates.
      if (existing.routeId !== null && (body.lat === null || body.lon === null)) {
        throw new AppError(
          "This stop is part of a route section — remove it from the route before clearing its coordinates",
          400,
        );
      }
      const stop = await prisma.tripStop.update({
        where: { id: req.params.stopId },
        data: {
          ...(body.title !== undefined && { title: body.title }),
          ...(body.domain !== undefined && { domain: body.domain }),
          ...(body.sourceId !== undefined && { sourceId: body.sourceId }),
          ...(body.description !== undefined && {
            description: body.description,
          }),
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

/**
 * DELETE /trips/:id/stops/:stopId
 *
 * A stop with no `routeId` is a plain timeline point — delete it and stop.
 * A stop that IS a route member needs more: the FK cascade already removes
 * its two adjacent `TripRouteLeg` rows (`onDelete: Cascade` on both
 * `fromStop`/`toStop`), but nothing re-creates the leg that should now span
 * its former neighbours, and the surviving members' `routeOrderIdx` goes
 * non-contiguous (e.g. 0, 2). Both are repaired here, inside one
 * transaction with the delete itself, so a section never observably passes
 * through the broken intermediate state.
 */
router.delete(
  "/trips/:id/stops/:stopId",
  authenticate,
  requireWriteScope,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const existing = await prisma.tripStop.findFirst({
        where: { id: req.params.stopId, tripId: req.params.id },
      });
      if (!existing) throw new AppError("Stop not found", 404);

      await prisma.$transaction(async (tx) => {
        await tx.tripStop.delete({ where: { id: req.params.stopId } });

        if (existing.routeId === null) return;

        const route = await tx.tripRoute.findUnique({
          where: { id: existing.routeId },
          select: { mode: true },
        });
        // The section itself may have been deleted concurrently (cascade
        // from a route DELETE) — nothing left to renumber or recompute.
        if (!route) return;

        const survivors = await tx.tripStop.findMany({
          where: { routeId: existing.routeId },
          orderBy: { routeOrderIdx: "asc" },
          select: { id: true, lat: true, lon: true },
        });

        for (let idx = 0; idx < survivors.length; idx++) {
          await tx.tripStop.update({
            where: { id: survivors[idx].id },
            data: { routeOrderIdx: idx },
          });
        }

        await recomputeLegs(tx, existing.routeId, route.mode, survivors);
      });

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
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
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
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
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
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const existing = await prisma.tripJournalEntry.findFirst({
        where: { id: req.params.entryId, tripId: req.params.id },
      });
      if (!existing) throw new AppError("Journal entry not found", 404);
      await prisma.tripJournalEntry.delete({
        where: { id: req.params.entryId },
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

/* ─────────── LLM summary (iter 9) ─────────── */

/** POST /trips/:id/summarize — generate + persist a 3-paragraph summary */
router.post(
  "/trips/:id/summarize",
  authenticate,
  requireWriteScope,
  emailParseLimiter,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);

      const ollamaUp = await checkOllamaAvailable();
      if (!ollamaUp) {
        throw new AppError(
          "LLM service unavailable. Set OLLAMA_URL and ensure the model is pulled.",
          503,
        );
      }

      const result = await summariseTrip(req.params.id, userId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

/* ─────────── Photos (iter 7) ─────────── */

const updatePhotoSchema = z.object({
  caption: z.string().max(500).nullable().optional(),
  takenAt: z.string().datetime().nullable().optional(),
  sortIdx: z.number().int().min(0).max(10000).optional(),
});

/**
 * POST /trips/:id/photos — upload one or more images.
 *
 * Shares the file-upload bucket with every other route that writes user bytes
 * to the data volume; 20 files of 15 MB per request is the same disk-exhaustion
 * shape as the place-visit photo upload, and the two must not disagree about
 * it. The limiter sits above multer so a refused request writes nothing.
 */
router.post(
  "/trips/:id/photos",
  authenticate,
  requireWriteScope,
  uploadReceiptLimiter,
  uploadTripPhotos.array("photos", 20),
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const uploaded: Express.Multer.File[] =
      (req.files as Express.Multer.File[] | undefined) ?? [];
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      if (uploaded.length === 0) throw new AppError("No photos uploaded", 400);

      const last = await prisma.tripPhoto.findFirst({
        where: { tripId: req.params.id },
        orderBy: { sortIdx: "desc" },
        select: { sortIdx: true },
      });
      let nextIdx = (last?.sortIdx ?? -1) + 1;

      const created = await prisma.$transaction(
        uploaded.map((f) =>
          prisma.tripPhoto.create({
            data: {
              tripId: req.params.id,
              filename: f.filename,
              mimetype: f.mimetype,
              sizeBytes: f.size,
              sortIdx: nextIdx++,
            },
          }),
        ),
      );
      res.status(201).json({ photos: created.map(toPhotoDto) });
    } catch (error) {
      // Cleanup uploaded files on any failure to avoid orphaning bytes.
      for (const f of uploaded) {
        try {
          // Rebuild from the trusted dir + basename of multer's generated
          // filename, not the raw f.path — defense-in-depth + clears the
          // CodeQL js/path-injection taint.
          const safePath = path.join(
            getTripPhotoDir(),
            path.basename(f.filename),
          );
          fs.existsSync(safePath) && fs.unlinkSync(safePath);
        } catch (_e) {
          logger.warn({
            operation: "trip_photo_upload_cleanup_error",
            message: "Failed to cleanup orphaned trip photo file",
            context: { filename: f.filename },
          });
        }
      }
      next(error);
    }
  },
);

/** GET /trips/:id/photos/:photoId/file — serve image bytes */
router.get(
  "/trips/:id/photos/:photoId/file",
  authenticate,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const photo = await prisma.tripPhoto.findFirst({
        where: { id: req.params.photoId, tripId: req.params.id },
      });
      if (!photo) throw new AppError("Photo not found", 404);
      const filePath = path.join(
        getTripPhotoDir(),
        path.basename(photo.filename),
      );
      if (!fs.existsSync(filePath)) throw new AppError("File missing", 404);
      res.type(photo.mimetype);
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  },
);

/** PATCH /trips/:id/photos/:photoId — update caption / sortIdx / takenAt */
router.patch(
  "/trips/:id/photos/:photoId",
  authenticate,
  requireWriteScope,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const existing = await prisma.tripPhoto.findFirst({
        where: { id: req.params.photoId, tripId: req.params.id },
      });
      if (!existing) throw new AppError("Photo not found", 404);
      const body = updatePhotoSchema.parse(req.body);
      const photo = await prisma.tripPhoto.update({
        where: { id: req.params.photoId },
        data: {
          ...(body.caption !== undefined && { caption: body.caption }),
          ...(body.takenAt !== undefined && {
            takenAt: body.takenAt ? new Date(body.takenAt) : null,
          }),
          ...(body.sortIdx !== undefined && { sortIdx: body.sortIdx }),
        },
      });
      res.json({ photo: toPhotoDto(photo) });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /trips/:id/photos/:photoId */
router.delete(
  "/trips/:id/photos/:photoId",
  authenticate,
  requireWriteScope,
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const photo = await prisma.tripPhoto.findFirst({
        where: { id: req.params.photoId, tripId: req.params.id },
      });
      if (!photo) throw new AppError("Photo not found", 404);
      await prisma.tripPhoto.delete({ where: { id: req.params.photoId } });
      deleteTripPhotoFile(photo.filename);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

/** POST /trips/:id/cover — upload single image and set as coverImageUrl */
router.post(
  "/trips/:id/cover",
  authenticate,
  requireWriteScope,
  uploadTripCover.single("cover"),
  async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const uploaded = req.file;
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      if (!uploaded) throw new AppError("No cover uploaded", 400);
      // Reuse the trip-photos directory but scope the URL under the
      // trip's REST namespace via a pseudo-photo row, so cover deletion
      // is unified with photo deletion later.
      const photo = await prisma.tripPhoto.create({
        data: {
          tripId: req.params.id,
          filename: uploaded.filename,
          mimetype: uploaded.mimetype,
          sizeBytes: uploaded.size,
          sortIdx: -1, // covers sort below user photos
          caption: "__cover__",
        },
      });
      const coverUrl = `/api/v1/trips/${req.params.id}/photos/${photo.id}/file`;
      const trip = await prisma.trip.update({
        where: { id: req.params.id },
        data: { coverImageUrl: coverUrl },
      });
      res.status(201).json({ trip, coverUrl });
    } catch (error) {
      if (uploaded) {
        try {
          // Rebuild from the trusted dir + basename of multer's generated
          // filename, not the raw uploaded.path — defense-in-depth + clears
          // the CodeQL js/path-injection taint.
          const safePath = path.join(
            getTripPhotoDir(),
            path.basename(uploaded.filename),
          );
          fs.existsSync(safePath) && fs.unlinkSync(safePath);
        } catch (_e) {
          logger.warn({
            operation: "trip_cover_upload_cleanup_error",
            message: "Failed to cleanup orphaned trip cover file",
            context: { filename: uploaded.filename },
          });
        }
      }
      next(error);
    }
  },
);

interface PhotoDto {
  id: string;
  url: string;
  caption: string | null;
  takenAt: string | null;
  sortIdx: number;
  mimetype: string;
  sizeBytes: number;
  createdAt: string;
}

function toPhotoDto(p: {
  id: string;
  tripId: string;
  caption: string | null;
  takenAt: Date | null;
  sortIdx: number;
  mimetype: string;
  sizeBytes: number;
  createdAt: Date;
}): PhotoDto {
  return {
    id: p.id,
    url: `/api/v1/trips/${p.tripId}/photos/${p.id}/file`,
    caption: p.caption,
    takenAt: p.takenAt?.toISOString() ?? null,
    sortIdx: p.sortIdx,
    mimetype: p.mimetype,
    sizeBytes: p.sizeBytes,
    createdAt: p.createdAt.toISOString(),
  };
}

export default router;
