import { Router, type NextFunction, type Response } from "express";

import { authenticate, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { TRAVTRACK_EXPORT_MAX_DAYS, travTrackExportQuerySchema } from "../../schemas/travtrack";
import {
  buildTravTrackExport,
  travTrackExportGpx,
  travTrackExportJson,
} from "../../services/travtrack/exportFormats";
import { resolveSpan } from "../../services/travtrack/range";
import { travTrackTier } from "./gate";

/**
 * `GET /travtrack/export?from&to|fromDay&toDay&format=gpx|json` (TravTrack
 * plan T6): a span of the history as a file — `exportFormats.ts`. Tier
 * `held`: with TravTrack switched off an account holding data still takes it
 * away (review focus 14). At most 366 days per request; a longer span is 400
 * `TRAVTRACK_EXPORT_TOO_LONG`, never a silently shortened file.
 */

const router = Router();

const stamp = (d: Date) => d.toISOString().slice(0, 10);

router.get(
  "/travtrack/export",
  authenticate,
  travTrackTier("held"),
  (req: AuthRequest, res: Response, next: NextFunction) => {
    void (async () => {
      const userId = req.userId!;
      const q = travTrackExportQuerySchema.parse(req.query);
      const span = await resolveSpan(userId, q);
      if (span.days > TRAVTRACK_EXPORT_MAX_DAYS) {
        throw new AppError(
          `An export covers at most ${TRAVTRACK_EXPORT_MAX_DAYS} days`,
          400,
          "TRAVTRACK_EXPORT_TOO_LONG"
        );
      }
      const window = { fromMs: span.from.getTime(), untilMs: span.to.getTime() };
      const built = await buildTravTrackExport(userId, window);
      const name = `travtrack_${stamp(span.from)}_${stamp(new Date(window.untilMs - 1))}`;
      res.setHeader("X-TravTrack-Origin", "travtrack");
      res.setHeader("X-TravTrack-Coverage", built.coverage);
      if (built.next) res.setHeader("X-TravTrack-Next", built.next);
      if (q.format === "gpx") {
        res.setHeader("Content-Type", "application/gpx+xml; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${name}.gpx"`);
        res.send(travTrackExportGpx(`TravTrack ${stamp(span.from)}`, built));
        return;
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${name}.json"`);
      res.send(JSON.stringify(travTrackExportJson(window, built)));
    })().catch(next);
  }
);

export default router;
