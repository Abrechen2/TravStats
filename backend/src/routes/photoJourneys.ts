import { Router, Response, NextFunction } from "express";
import { toLocal } from "../shared/time/instant";
import { zoneOfCoordinates } from "../shared/time/resolveInput";
import { z } from "zod";

import { prisma } from "../db";
import { AppError } from "../middleware/errorHandler";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { immichImportLimiter } from "../middleware/rateLimit";
import { scanPhotoJourneys } from "../services/photoJourneys/scan";
import { acceptVisitFinding } from "../services/photoJourneys/acceptVisit";
import { attachJourneyPhotosToVisit } from "../services/places/visitPhotoLinks";
import { startJob } from "../services/jobs/jobRegistry";

const router = Router();
router.use(authenticate);
// A read-scoped token may read. It may not upload training material, annotate
// it, or change a suggested journey's state (audit finding AUD-012).
// `requireWriteScope` lets GET/HEAD/OPTIONS through untouched, so this covers
// every mutating route here without listing them.
router.use(requireWriteScope);

/**
 * Journeys the photo library suggests and the journal never heard of.
 *
 * The scan reads the user's own Immich, clusters photos in time, discards
 * everything a recorded flight, cruise, trip or stay already explains, and
 * reverse-geocodes what is left. See `services/photoJourneys/scan.ts`.
 *
 * Everything this exposes is a SUGGESTION. A photograph proves where a
 * camera was, which is usually but not always where its owner was, so no
 * route here creates travel — accepting one is a separate, deliberate act
 * through the normal trip endpoints.
 */

/** How far back a scan looks when the caller does not say. */
const DEFAULT_LOOKBACK_YEARS = 10;

const listQuerySchema = z.object({
  status: z.enum(["pending", "accepted", "dismissed"]).default("pending"),
});

const scanBodySchema = z.object({
  /** ISO dates. Both optional; the default window is the last ten years. */
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  /** Answer 202 with a job instead of holding the request open (2026-09-26).
   *  Forty seconds is the scan's FLOOR (see below) against a browser that
   *  gives up after ten, so the web client announced "scan failed" while the
   *  server stored its findings. The Companion keeps the synchronous call. */
  background: z.boolean().default(false),
});

const patchBodySchema = z.object({
  status: z.enum(["accepted", "dismissed"]),
  /** Set when accepting produced a trip, so the row can point at it. */
  createdTripId: z.string().uuid().optional(),
  /** Accepting a `place` finding records a visit; a `stay` finding, a stay. */
  createdPlaceVisitId: z.string().uuid().optional(),
  createdLodgingStayId: z.string().uuid().optional(),
  /**
   * `visit` findings only (forgejo#211): the server creates the place, and
   * these override what the scan called it. `name` is required by the server
   * when the scan named nothing.
   */
  name: z.string().trim().min(1).max(200).optional(),
  localName: z.string().trim().max(200).optional(),
});

/**
 * 404 unless every id the caller links is their own. The columns carry no
 * foreign key, and even one would prove only that the row EXISTS — pointing a
 * journey at a stranger's trip must fail like pointing it at nothing.
 */
async function assertCreatedOwned(
  userId: string,
  body: z.infer<typeof patchBodySchema>
): Promise<void> {
  const checks = [
    body.createdTripId &&
      prisma.trip.findFirst({ where: { id: body.createdTripId, userId }, select: { id: true } }),
    body.createdPlaceVisitId &&
      prisma.placeVisit.findFirst({
        where: { id: body.createdPlaceVisitId, userId },
        select: { id: true },
      }),
    body.createdLodgingStayId &&
      prisma.lodgingStay.findFirst({
        where: { id: body.createdLodgingStayId, userId },
        select: { id: true },
      }),
  ].filter(Boolean);
  const found = await Promise.all(checks);
  if (found.some((row) => row === null)) throw new AppError("Linked entry not found", 404);
}

const settingsBodySchema = z.object({ nightlyScan: z.boolean() }).strict();

/**
 * The account's opt-in to the nightly scan (forgejo#94, point 5). Off until the
 * user turns it on: the scan reads their library and asks a third-party
 * geocoder about what it finds (see jobs/photoJourneyScanScheduler.ts).
 */
router.get(
  "/settings",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const row = await prisma.userSettings.findUnique({
        where: { userId: req.userId! },
        select: { photoJourneyNightlyScan: true },
      });
      res.json({ success: true, data: { nightlyScan: row?.photoJourneyNightlyScan ?? false } });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/settings",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = settingsBodySchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const update = { photoJourneyNightlyScan: parsed.data.nightlyScan };
      const row = await prisma.userSettings.upsert({
        where: { userId: req.userId! },
        update,
        create: { userId: req.userId!, data: {}, ...update },
        select: { photoJourneyNightlyScan: true },
      });
      res.json({ success: true, data: { nightlyScan: row.photoJourneyNightlyScan } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * What to call a finding (forgejo#132 item 20) — so a place find is not titled
 * "Warst du hier?". Resolved from what is ALREADY stored, never by a lookup per
 * request: the own place a `place`/`stay` finding points at, else the city and
 * then the country the scan's reverse lookup stored. Null when none is known.
 * The place must be the caller's; the scan only ever writes their own, but a
 * name is read out of the database here, so the check costs nothing.
 */
function withNames<
  T extends {
    place: { name: string; userId: string } | null;
    trip: { name: string } | null;
    suggestedName: string | null;
  },
>(journey: T & { city: string | null; countryName: string | null }, userId: string) {
  const { place, trip, ...row } = journey;
  const placeName = place && place.userId === userId ? place.name : null;
  return {
    ...row,
    placeName,
    // A `visit` finding is named by what the lookup found at the stop; the
    // own place it points at, where there is one, is that name already.
    tripName: trip?.name ?? null,
    label: placeName ?? row.suggestedName ?? row.city ?? row.countryName ?? null,
  };
}

/**
 * The finding's first and last day on the clock where its photos were taken
 * (ADR 0002 D4: a calendar day is the place's question). Accepting a trip
 * finding creates the trip with these days; the first photo's instant, read
 * as a day, is its UTC date — a Tokyo trip whose first photo was taken at
 * 01:00 on 2 May started on 1 May. Null when the position has no zone.
 *
 * The wall clocks travel too (`startLocal`/`endLocal`, `YYYY-MM-DDTHH:mm:ss`):
 * a `visit` finding is an afternoon, not a span of days, and the card shows
 * when on the place's clock — never on the reader's.
 */
function withLocalDays<T extends { startDate: Date; endDate: Date; lat: number; lon: number }>(
  journey: T
): T & {
  startDay: string | null;
  endDay: string | null;
  startLocal: string | null;
  endLocal: string | null;
} {
  const zone = zoneOfCoordinates(journey.lat, journey.lon);
  const startLocal = zone ? toLocal(journey.startDate, zone).local : null;
  const endLocal = zone ? toLocal(journey.endDate, zone).local : null;
  return {
    ...journey,
    startDay: startLocal?.slice(0, 10) ?? null,
    endDay: endLocal?.slice(0, 10) ?? null,
    startLocal,
    endLocal,
  };
}

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const userId = req.userId!;
    const journeys = await prisma.photoJourney.findMany({
      where: { userId, status: parsed.data.status },
      orderBy: { startDate: "desc" },
      include: {
        place: { select: { name: true, userId: true } },
        trip: { select: { name: true } },
      },
    });

    res.json({
      success: true,
      data: journeys.map((j) => withLocalDays(withNames(j, userId))),
    });
  } catch (err) {
    next(err);
  }
});

const forTripParamsSchema = z.object({ tripId: z.string().uuid() });
/** Accepted journeys one trip can have made; far more would be a data error, not a gallery. */
const FOR_TRIP_CAP = 20;

/**
 * The accepted findings that made this trip, with how many preview photographs
 * each carries — the trip gallery draws them through the preview proxy.
 *
 * This is how a trip finding brings its photographs along. A trip photo is a
 * FILE (`TripPhoto.filename` is required, and the import job and resync depend
 * on that), and link mode is an ALBUM, which a finding does not have. The
 * journey row already points at the trip and already grants its own previews
 * (`/photo-journeys/:id/preview/:index/file`), so the link exists; it only
 * needed a reader. Zero bytes, and no id ever leaves the server.
 */
router.get(
  "/for-trip/:tripId",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = forTripParamsSchema.safeParse(req.params);
      if (!parsed.success) throw new AppError("Invalid trip id", 400);
      const trip = await prisma.trip.findFirst({
        where: { id: parsed.data.tripId, userId: req.userId! },
        select: { id: true },
      });
      if (!trip) throw new AppError("Trip not found", 404);

      const rows = await prisma.photoJourney.findMany({
        where: { userId: req.userId!, createdTripId: trip.id, status: "accepted" },
        select: { id: true, previewAssetIds: true },
        orderBy: { startDate: "asc" },
        take: FOR_TRIP_CAP,
      });
      res.json({
        success: true,
        data: rows.map((row) => ({ id: row.id, previewCount: row.previewAssetIds.length })),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * The scan is the expensive one and the only route here that is limited.
 *
 * A single call reads the user's whole Immich library across a ten-year
 * default window, clusters it, and reverse-geocodes every surviving cluster
 * against Nominatim — whose usage policy is what gets an instance's IP banned.
 * `MAX_LOOKUPS` in the scan service caps that at 40 lookups, and since
 * Nominatim is throttled to 1 req/s upstream, 40 seconds is the scan's FLOOR,
 * not its worst case. The cost is set by the size of someone else's photo
 * library and by a third party's tolerance, neither of which this process
 * controls, so the one thing it can bound is how often the request is allowed
 * to start. It shares `immichImportLimiter` with the album import for that
 * reason.
 *
 * The list and the accept/dismiss patch are single indexed statements against
 * the caller's own rows and stay unlimited.
 */
router.post(
  "/scan",
  immichImportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = scanBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new AppError(parsed.error.message, 400);

      const until = parsed.data.until ? new Date(parsed.data.until) : new Date();
      const since = parsed.data.since
        ? new Date(parsed.data.since)
        : new Date(
            Date.UTC(
              until.getUTCFullYear() - DEFAULT_LOOKBACK_YEARS,
              until.getUTCMonth(),
              until.getUTCDate()
            )
          );
      if (since >= until) {
        throw new AppError("since must be before until", 400);
      }

      const userId = req.userId!;
      const run = async () => {
        const outcome = await scanPhotoJourneys(userId, { since, until });
        // Not an error: an account without Immich is a normal account, and
        // a 4xx here would make the Companion show a failure for a feature
        // the user simply has not connected.
        return outcome.kind === "no-immich"
          ? { scanned: false as const, reason: "immich-not-configured" as const }
          : { scanned: true as const, ...outcome };
      };

      if (parsed.data.background) {
        const job = startJob("photoJourneys.scan", userId, run);
        res.status(202).json({ success: true, data: { jobId: job.id } });
        return;
      }
      res.json({ success: true, data: await run() });
    } catch (err) {
      next(err);
    }
  }
);

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = patchBodySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    await assertCreatedOwned(req.userId!, parsed.data);

    // A `visit` finding is the one kind the server accepts by CREATING: the
    // place (unless an own one takes it) and the visit in the trip, in one
    // transaction — see `services/photoJourneys/acceptVisit.ts`. Its photos
    // come along the same way a place finding's do. Dismissing it is the
    // ordinary path below.
    const row = await prisma.photoJourney.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      select: { kind: true },
    });
    if (row?.kind === "visit" && parsed.data.status === "accepted") {
      const created = await acceptVisitFinding(req.userId!, req.params.id, parsed.data);
      const photos = await attachJourneyPhotosToVisit(
        req.userId!,
        req.params.id,
        created.placeVisitId
      );
      res.json({ success: true, data: { photos, created } });
      return;
    }

    // Scoped by userId in the WHERE, not checked after loading: a
    // journey belonging to someone else must be a 404, never a row we
    // fetched and then decided not to show.
    const { count } = await prisma.photoJourney.updateMany({
      where: { id: req.params.id, userId: req.userId! },
      data: {
        status: parsed.data.status,
        createdTripId: parsed.data.createdTripId ?? null,
        createdPlaceVisitId: parsed.data.createdPlaceVisitId ?? null,
        createdLodgingStayId: parsed.data.createdLodgingStayId ?? null,
        resolvedAt: new Date(),
      },
    });
    if (count === 0) {
      throw new AppError("Photo journey not found", 404);
    }

    // A visit made from a finding carries the finding's photographs as links —
    // the pictures were the evidence, and leaving them behind made the user
    // find them again by hand. Reported, never thrown: the answer is recorded.
    const photos =
      parsed.data.status === "accepted" && parsed.data.createdPlaceVisitId
        ? await attachJourneyPhotosToVisit(
            req.userId!,
            req.params.id,
            parsed.data.createdPlaceVisitId
          )
        : null;

    res.json({ success: true, data: { photos, created: null } });
  } catch (err) {
    next(err);
  }
});

export default router;
