import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../db";
import { AppError } from "../middleware/errorHandler";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { immichImportLimiter } from "../middleware/rateLimit";
import { scanPhotoJourneys } from "../services/photoJourneys/scan";

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
});

const patchBodySchema = z.object({
  status: z.enum(["accepted", "dismissed"]),
  /** Set when accepting produced a trip, so the row can point at it. */
  createdTripId: z.string().uuid().optional(),
  /** Accepting a `place` finding records a visit; a `stay` finding, a stay. */
  createdPlaceVisitId: z.string().uuid().optional(),
  createdLodgingStayId: z.string().uuid().optional(),
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

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);

    const journeys = await prisma.photoJourney.findMany({
      where: { userId: req.userId!, status: parsed.data.status },
      orderBy: { startDate: "desc" },
    });

    res.json({ success: true, data: journeys });
  } catch (err) {
    next(err);
  }
});

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

      const outcome = await scanPhotoJourneys(req.userId!, { since, until });

      // Not an error: an account without Immich is a normal account, and
      // a 4xx here would make the Companion show a failure for a feature
      // the user simply has not connected.
      if (outcome.kind === "no-immich") {
        res.json({
          success: true,
          data: { scanned: false, reason: "immich-not-configured" },
        });
        return;
      }

      res.json({ success: true, data: { scanned: true, ...outcome } });
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

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
