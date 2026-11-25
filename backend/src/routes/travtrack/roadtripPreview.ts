import { Router, type NextFunction, type Response } from "express";

import { authenticate, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { travTrackViewLimiter } from "../../middleware/travTrackViewLimits";
import { z } from "../../schemas/zod";
import { resolveSpan } from "../../services/travtrack/range";
import { PreviewError, roadtripPreviewFor } from "../../services/travtrack/roadtrip/load";
import { travTrackTier } from "./gate";

/**
 * `GET /travtrack/roadtrip-preview` (rc46 extras A, "Als Roadtrip
 * übernehmen"): the stations and the line a roadtrip would get from a
 * recorded span — a leg (`fromMs`/`untilMs`) or days on the profile clock
 * (`fromDay`/`toDay`, both inclusive, at most 14). Reads only; the roadtrip
 * itself is written through the roadtrip and tour APIs. Bare (ADR 0001).
 */

const router = Router();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.union([
  z.object({ fromDay: day, toDay: day }).strict(),
  z.object({ fromMs: z.coerce.number().int(), untilMs: z.coerce.number().int() }).strict(),
]);

const STATUS = { tooLong: 400, noPoints: 422, truncated: 422, tooFewStations: 422 } as const;

router.get(
  "/travtrack/roadtrip-preview",
  authenticate,
  travTrackTier("on"),
  travTrackViewLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const q = query.parse(req.query);
      let span: { fromMs: number; untilMs: number };
      let days: number;
      if ("fromDay" in q) {
        if (q.fromDay > q.toDay) throw new AppError("fromDay must not be after toDay", 400);
        const r = await resolveSpan(req.userId!, q);
        span = { fromMs: r.from.getTime(), untilMs: r.to.getTime() };
        days = r.days;
      } else {
        if (q.untilMs <= q.fromMs) throw new AppError("untilMs must be after fromMs", 400);
        span = { fromMs: q.fromMs, untilMs: q.untilMs };
        days = (q.untilMs - q.fromMs) / 86_400_000;
      }
      res.json(await roadtripPreviewFor(req.userId!, span, days));
    } catch (error) {
      if (error instanceof PreviewError) {
        next(
          new AppError(
            `Roadtrip preview failed: ${error.reason}`,
            STATUS[error.reason],
            "TRAVTRACK_ROADTRIP_PREVIEW_FAILED",
            undefined,
            {
              reason: error.reason,
            }
          )
        );
        return;
      }
      next(error);
    }
  }
);

export default router;
