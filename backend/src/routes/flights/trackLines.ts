import { Router, type NextFunction, type Response } from "express";

import { prisma } from "../../db";
import { authenticate, type AuthRequest } from "../../middleware/auth";
import { providerIs } from "../../services/locationProvider/provider";
import { cutGeometry } from "../../services/travtrack/cutGeometry";
import { travTrackFlightLines } from "../../services/travtrack/flightLines";
import { privacyCircleSet } from "../../services/travtrack/privacyCircles";
import type { LonLat } from "../../services/travtrack/privacyCut";

/**
 * `GET /flights/track-lines` — every recorded flight line of the caller, for
 * the map (forgejo#312): a flight with a recording is drawn along it instead
 * of along the great circle.
 *
 * A separate read rather than a property on `/flights/geo`: that handler sits
 * in `routes/flights.ts`, which the file-size baseline freezes, and the map
 * pages through `/geo` 500 rows at a time — a line per feature would ride
 * along on every page whether the map wanted it or not. Mounted BEFORE the
 * flights router, whose `GET /:id` would otherwise read "track-lines" as an id.
 *
 * Only the simplified line and its segment starts (the holes stay holes on
 * the map). Times, altitudes and the device stay on `GET /flights/:id/track`.
 *
 * Since TravTrack (plan T5) every line names its `origin`. A flight without an
 * own recording is drawn from TravTrack when that is the account's working
 * provider. Dawarich lines are NOT fetched here: one remote window per flight
 * on every map load is a fan-out the map must not wait on — those flights keep
 * their great circle and show the Dawarich track on their own page. Every line
 * leaves through `privacyCut`.
 */
const router = Router();
router.use(authenticate);

const asLine = (value: unknown): LonLat[] => (Array.isArray(value) ? (value as LonLat[]) : []);
const asStarts = (value: unknown): number[] => (Array.isArray(value) ? (value as number[]) : [0]);

router.get("/track-lines", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const [rows, circles, travTrack] = await Promise.all([
      prisma.flightTrack.findMany({
        where: { flight: { userId } },
        select: { flightId: true, geometry: true, segmentStarts: true, startedAt: true },
        orderBy: { flightId: "asc" },
      }),
      privacyCircleSet(userId),
      providerIs(userId, "travtrack"),
    ]);
    const own = rows.map((row) => ({
      flightId: row.flightId,
      ...cutGeometry(
        asLine(row.geometry),
        asStarts(row.segmentStarts),
        circles(row.startedAt.getTime())
      ),
      origin: "travstats" as const,
    }));
    const fromTravTrack = travTrack ? await travTrackFlightLines(userId, circles) : [];
    res.json({ lines: [...own, ...fromTravTrack] });
  } catch (err) {
    next(err);
  }
});

export default router;
