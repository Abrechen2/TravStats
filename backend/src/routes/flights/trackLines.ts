import { Router, type NextFunction, type Response } from "express";

import { prisma } from "../../db";
import { authenticate, type AuthRequest } from "../../middleware/auth";

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
 */
const router = Router();
router.use(authenticate);

router.get("/track-lines", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.flightTrack.findMany({
      where: { flight: { userId: req.userId! } },
      select: { flightId: true, geometry: true, segmentStarts: true },
      orderBy: { flightId: "asc" },
    });
    res.json({ lines: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
