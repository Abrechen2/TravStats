import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { Prisma } from "../prisma";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { linkDocuments, takeDocumentIds } from "../services/documents/documentService";
import {
  createTripSchema,
  updateTripSchema,
  assignFlightsSchema,
  createBookingSchema,
  updateBookingSchema,
  TRIP_COLORS,
} from "../schemas/trip";
import logger from "../utils/logger";
import { resolveCompanions, linkRowsFor } from "../services/companionService";
import { deriveTripStatus } from "../shared/statusDerivation";

import { detectTrips } from "../services/tripDetectionService";
import { recomputeTripStatus } from "../services/tripStatusService";
import { restatusIfDatesMoved } from "../services/trip/restatusAfterEdit";
import {
  findMicroTripCandidates,
  dissolveMicroTrips,
  mergeTrips,
} from "../services/tripCleanupService";
import {
  summariseTrip,
  checkOllamaAvailable,
  resolveOllamaTarget,
} from "../services/tripSummaryService";
import { emailParseLimiter } from "../middleware/rateLimit";
import { fxColumnsFor, getBaseCurrency } from "../services/fx/snapshot";
import { mostExpensiveTrip } from "../services/trip/tripCostSuperlative";
import { TRIPS_LIST_INCLUDE } from "../services/trip/tripsListInclude";
import {
  airportFactsFor,
  tripCountries,
  cruiseCountriesByTrip,
  lodgingCountriesByTrip,
} from "./trips/tripCountries";
import { resolveTrip } from "./trips/resolveTrip";
import { refusesCoverImage } from "./trips/refusesCoverImage";
import { toPhotoDto } from "./trips/photoDto";

// Re-exported for the Immich trip routers, which import it from here.
export { resolveTrip };

const router = Router();

/**
 * `GET /trips?includeInsights=true` — see the comment at its only reader.
 * NOT `z.coerce.boolean()`: that coerces via `Boolean(str)`, under which the
 * literal string "false" is truthy — `?includeInsights=false` would turn the
 * flag ON.
 */
const tripsListQuerySchema = z.object({
  includeInsights: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

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
  }
);

/** GET /trips — list all trips for the current user */
router.get(
  "/trips",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      // Opt-in: the cost superlative below runs an UNCAPPED query over every
      // trip the user has, specifically so it is not limited by the `take`s
      // in the main query below — computing it on every caller of this very
      // popular endpoint (StayEditor, PlaceDetailPage, FlightsTablePage, …)
      // would tax pages that never show it. Only the trips page asks.
      const { includeInsights } = tripsListQuerySchema.parse(req.query);
      const trips = await prisma.trip.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 500, // safety cap — users are unlikely to have more than 500 trips
        include: TRIPS_LIST_INCLUDE,
      });
      // One batched airport lookup across EVERY trip's flights, not one per
      // trip: the cards need the same country derivation the detail page does,
      // and doing it per trip would turn one page load into N queries.
      // Cruise distance lives on the legs the sea router computed, one row per
      // port-to-port hop. One grouped query over every cruise on the page keeps
      // this at a constant query count, like the airport lookup above.
      const cruiseIds = trips.flatMap((t) => t.cruises.map((c) => c.id));
      const [facts, cruiseCountries, lodgingCountries, legSums] = await Promise.all([
        airportFactsFor(trips.flatMap((t) => t.flights)),
        cruiseCountriesByTrip(trips.map((t) => t.id)),
        lodgingCountriesByTrip(trips.map((t) => t.id)),
        cruiseIds.length > 0
          ? prisma.cruiseLeg.groupBy({
              by: ["cruiseId"],
              where: { cruiseId: { in: cruiseIds } },
              _sum: { distanceKm: true },
            })
          : Promise.resolve([]),
      ]);
      const distanceByCruise = new Map(
        legSums.map((row) => [row.cruiseId, row._sum.distanceKm ?? 0])
      );
      // Uncapped by design (see the comment above `includeInsights`) — it
      // runs its OWN query over every trip the user has, never the 500/200
      // caps this handler applies above.
      const mostExpensive = includeInsights ? await mostExpensiveTrip(userId) : undefined;
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
            lodgingCountries.get(t.id) ?? []
          ),
        })),
        ...(includeInsights && { mostExpensiveTrip: mostExpensive }),
      });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /trips/bookings — create a booking (must come before /trips/:id) */
router.post(
  "/trips/bookings",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
  }
);

/** PATCH /trips/bookings/:id — edit pnr/price/currency. Never touches the
 *  booking's flights (their prices stay whatever they are). */
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
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidates = await findMicroTripCandidates(req.userId!);
      res.json({ candidates });
    } catch (error) {
      next(error);
    }
  }
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
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tripIds } = dissolveTripsSchema.parse(req.body);
      const result = await dissolveMicroTrips(req.userId!, tripIds);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
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
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = mergeTripsSchema.parse(req.body);
      const result = await mergeTrips(req.userId!, body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/** GET /trips/:id */
router.get(
  "/trips/:id",
  authenticate,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
      const photos = trip.photos.filter((p) => p.caption !== "__cover__").map(toPhotoDto);
      // One airport lookup serves two gaps the beta UAT found: the timeline
      // rendered each end in the VIEWER's clock (a JFK arrival read six hours
      // off), and the countries tile stayed at 0 because `trips.countries` is a
      // stored column nobody derives and `overflownCountries` is empty for
      // manually created flights.
      const [facts, cruiseCountries, lodgingCountries] = await Promise.all([
        airportFactsFor(trip.flights),
        cruiseCountriesByTrip([trip.id]),
        lodgingCountriesByTrip([trip.id]),
      ]);
      const flights = trip.flights.map((f) => ({
        ...f,
        depTimezone: (f.depIata && facts.get(f.depIata)?.timezone) || null,
        arrTimezone: (f.arrIata && facts.get(f.arrIata)?.timezone) || null,
      }));
      const countries = tripCountries(
        trip.countries,
        trip.flights,
        facts,
        cruiseCountries.get(trip.id) ?? [],
        lodgingCountries.get(trip.id) ?? []
      );
      res.json({ trip: { ...trip, photos, flights, countries } });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /trips */
router.post(
  "/trips",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const body = createTripSchema.parse(req.body);
      if (await refusesCoverImage(userId, body.coverImageUrl, res)) return;
      const documentIds = await takeDocumentIds(userId, req.body);

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
      const resolvedCompanions = await resolveCompanions(userId, companionNames);

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
            data: linkRowsFor(resolvedCompanions.map((c) => c.id)).map((row) => ({
              ...row,
              tripId: created.id,
            })),
            skipDuplicates: true,
          });
        }

        return created;
      });
      await linkDocuments(userId, documentIds, { type: "trip", id: trip.id });

      logger.info({ tripId: trip.id, userId }, "[Trips] Created trip");
      res.status(201).json({ trip });
    } catch (error) {
      next(error);
    }
  }
);

/** PATCH /trips/:id */
router.patch(
  "/trips/:id",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const existing = await prisma.trip.findFirst({
        where: { id: req.params.id, userId },
      });
      if (!existing) throw new AppError("Trip not found", 404);

      const body = updateTripSchema.parse(req.body);
      if (await refusesCoverImage(userId, body.coverImageUrl, res)) return;

      // Status derivation (spec 2026-07-17-status-from-dates): the schema
      // still ACCEPTS `status` for API compat (never a 400), but the route
      // ignores it — a stale client's guess must not fight the derivation.
      if (body.status !== undefined) {
        logger.debug({ operation: "trip_status_field_ignored", tripId: req.params.id });
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
      let resolvedCompanionsForUpdate: { id: string; displayName: string }[] | undefined;
      if (body.companions !== undefined) {
        resolvedCompanionsForUpdate = await resolveCompanions(userId, body.companions);
      }

      const trip = await prisma.$transaction(async (tx) => {
        if (resolvedCompanionsForUpdate !== undefined) {
          await tx.tripCompanion.deleteMany({ where: { tripId: existing.id } });
          if (resolvedCompanionsForUpdate.length > 0) {
            await tx.tripCompanion.createMany({
              data: linkRowsFor(resolvedCompanionsForUpdate.map((c) => c.id)).map((row) => ({
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

      // Moving a trip's own dates moves its status, and this handler never
      // recomputed at all (AUD-024). After the transaction, like every other
      // caller: the derivation reads the row it is about to judge.
      res.json({ trip: await restatusIfDatesMoved(trip, body) });
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /trips/:id */
router.delete(
  "/trips/:id",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const existing = await prisma.trip.findFirst({
        where: { id: req.params.id, userId },
      });
      if (!existing) throw new AppError("Trip not found", 404);

      // A roadtrip is a domain of its own and outlives the trip, as a flight
      // or a cruise does; the schema's cascade is right for a day tour drawn
      // over the trip's timeline and wrong for it. Its stations borrowed from
      // the timeline become its own first — they would go with the trip.
      await prisma.$transaction(async (tx) => {
        const roadtrips = await tx.tripRoute.findMany({
          where: { tripId: existing.id, kind: "roadtrip" },
          select: { id: true },
        });
        const ids = roadtrips.map((r) => r.id);
        if (ids.length > 0) {
          await tx.tripStop.updateMany({
            where: { routeId: { in: ids }, tripId: existing.id },
            data: { tripId: null, domain: "roadtrip" },
          });
          await tx.tripRoute.updateMany({ where: { id: { in: ids } }, data: { tripId: null } });
        }
        await tx.trip.delete({ where: { id: existing.id } });
      });
      logger.info({ tripId: req.params.id, userId }, "[Trips] Deleted trip");
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

/** POST /trips/:id/flights — assign/unassign flights */
router.post(
  "/trips/:id/flights",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
  }
);

/* ─────────── LLM summary (iter 9) ─────────── */

/**
 * The reader's language travels with the request: the server keeps no
 * per-user language (the frontend detects it and stores it client-side), and
 * a German instance with an English reader must not get a German summary.
 * Absent means German, the app's primary language.
 */
const summarizeBodySchema = z.object({
  language: z.enum(["de", "en"]).optional(),
});

/**
 * POST /trips/:id/summarize — generate + persist a 3-paragraph summary
 *
 * Refused for the SHARED demo account, for the same reason the Immich and
 * Dawarich resolvers hand it nothing (independent review 2026-09-17, A2): the
 * target below is the OPERATOR's Ollama, lent to every account on the
 * instance. That is a fair loan to the people they invited, and an open
 * compute endpoint for the `demo` login whose password is printed on a public
 * login page. The frontend stops offering the card for that account, so this
 * is the door behind the hidden button, not the user-facing refusal.
 */
router.post(
  "/trips/:id/summarize",
  authenticate,
  rejectDemo,
  requireWriteScope,
  emailParseLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);

      const parsed = summarizeBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const language = parsed.data.language ?? "de";

      // The admin's Ollama (parser settings), then the environment — the same
      // resolution the parsers use, so one configured Ollama serves both.
      const target = await resolveOllamaTarget();
      const ollamaUp = await checkOllamaAvailable(target);
      if (!ollamaUp) {
        throw new AppError(
          "LLM service unavailable. Configure Ollama under Admin → Parser and ensure the model is pulled.",
          503
        );
      }

      const result = await summariseTrip(req.params.id, userId, { language, target });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
