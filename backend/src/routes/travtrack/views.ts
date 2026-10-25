import { Router, type NextFunction, type Response } from "express";

import { authenticate, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { travTrackViewLimiter } from "../../middleware/travTrackViewLimits";
import { travTrackMonthsQuerySchema } from "../../schemas/travtrack";
import {
  TRAVTRACK_RANGE_MAX_DAYS,
  travTrackFlightIdSchema,
  travTrackRangeViewQuerySchema,
  travTrackStaysQuerySchema,
} from "../../schemas/travtrackViews";
import { travTrackFlightPanel } from "../../services/travtrack/flightPanel";
import { travTrackCalendar } from "../../services/travtrack/months/calendar";
import { resolveSpan } from "../../services/travtrack/range";
import { travTrackRange } from "../../services/travtrack/rangeView";
import { parseSafeCursor } from "../../services/travtrack/readSafe";
import { parseStayCursor, travTrackStays } from "../../services/travtrack/stays";
import { travTrackTier } from "./gate";

/**
 * The Track area's further views (TravTrack plan T5.3): a range of the map
 * (Monat / Jahr / Zeitraum), a flight's altitude and speed, the stays and the
 * Statistik calendar. Tier `on`: views, answered only while the instance
 * shows TravTrack. Bare (ADR 0001), private to the owner, `no-store` like all
 * of `/api`. Every one reads through the privacy-safe read or a projection
 * built from it.
 */

const router = Router();

function route(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}

/**
 * GET /travtrack/range?fromDay&toDay (or from&to) [&cursor] — the span's
 * safe stretches, simplified, in parts: `cursor` while more remain.
 */
router.get(
  "/travtrack/range",
  authenticate,
  travTrackTier("on"),
  travTrackViewLimiter,
  route(async (req, res) => {
    const userId = req.userId!;
    const q = travTrackRangeViewQuerySchema.parse(req.query);
    const span = await resolveSpan(userId, q);
    if (span.days > TRAVTRACK_RANGE_MAX_DAYS) {
      throw new AppError(
        `A range covers at most ${TRAVTRACK_RANGE_MAX_DAYS} days`,
        400,
        "TRAVTRACK_RANGE_TOO_LONG"
      );
    }
    const window = { fromMs: span.from.getTime(), untilMs: span.to.getTime() };
    res.json(await travTrackRange(userId, window, parseSafeCursor(q.cursor)));
  })
);

/** GET /travtrack/flights/:id/panel — the linked points' altitude and speed over time. */
router.get(
  "/travtrack/flights/:id/panel",
  authenticate,
  travTrackTier("on"),
  travTrackViewLimiter,
  route(async (req, res) => {
    const id = travTrackFlightIdSchema.safeParse(req.params.id);
    if (!id.success) throw new AppError("No such flight", 404, "TRAVTRACK_FLIGHT_NOT_FOUND");
    res.json(await travTrackFlightPanel(req.userId!, id.data));
  })
);

/** GET /travtrack/stays?status&fromDay&toDay&cursor&limit — the stays across their states. */
router.get(
  "/travtrack/stays",
  authenticate,
  travTrackTier("on"),
  travTrackViewLimiter,
  route(async (req, res) => {
    const userId = req.userId!;
    const q = travTrackStaysQuerySchema.parse(req.query);
    const span =
      q.fromDay !== undefined && q.toDay !== undefined
        ? await resolveSpan(userId, { fromDay: q.fromDay, toDay: q.toDay })
        : null;
    res.json(
      await travTrackStays(userId, {
        states: q.status,
        from: span?.from,
        to: span?.to,
        cursor: parseStayCursor(q.cursor),
        limit: q.limit,
      })
    );
  })
);

/** GET /travtrack/calendar?year — the year's days with ground kilometres. */
router.get(
  "/travtrack/calendar",
  authenticate,
  travTrackTier("on"),
  travTrackViewLimiter,
  route(async (req, res) => {
    const { year } = travTrackMonthsQuerySchema.parse(req.query);
    res.json(await travTrackCalendar(req.userId!, year));
  })
);

export default router;
