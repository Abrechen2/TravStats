import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../db";
import { AppError } from "../middleware/errorHandler";
import { authenticate, AuthRequest } from "../middleware/auth";
import { scanPhotoJourneys } from "../services/photoJourneys/scan";

const router = Router();
router.use(authenticate);

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
});

/** The user's home airport, for the "this is not daily life" floor. */
async function homePosition(
  userId: string,
): Promise<{ lat: number; lon: number } | null> {
  // The most-departed airport is the honest stand-in for "home": it needs
  // no setting, no prompt, and it is already how the rest of the app
  // decides what counts as a home base.
  const grouped = await prisma.flight.groupBy({
    by: ["depIata", "depLat", "depLon"],
    where: { userId, depIata: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { depIata: "desc" } },
    take: 1,
  });
  const top = grouped[0];
  if (top === undefined) {
    return null;
  }
  return { lat: top.depLat, lon: top.depLon };
}

router.get(
  "/",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
  },
);

router.post(
  "/scan",
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
              until.getUTCDate(),
            ),
          );
      if (since >= until) {
        throw new AppError("since must be before until", 400);
      }

      const outcome = await scanPhotoJourneys(req.userId!, {
        since,
        until,
        home: await homePosition(req.userId!),
      });

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
  },
);

router.patch(
  "/:id",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = patchBodySchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);

      // Scoped by userId in the WHERE, not checked after loading: a
      // journey belonging to someone else must be a 404, never a row we
      // fetched and then decided not to show.
      const { count } = await prisma.photoJourney.updateMany({
        where: { id: req.params.id, userId: req.userId! },
        data: {
          status: parsed.data.status,
          createdTripId: parsed.data.createdTripId ?? null,
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
  },
);

export default router;
