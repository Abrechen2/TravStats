import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { loadFerryStats } from "../../services/ferry/ferryStats";

/**
 * GET /api/v1/ferry/stats — the ferry statistics (companion#85). Enveloped, as
 * the rest of the ferry family. Mounted ahead of the ferry router, whose `/:id`
 * would otherwise take "stats" for a crossing id. Answers whatever the domain
 * toggle says; the toggle hides the tab, it is not a boundary.
 */
const router = Router();
router.use(authenticate);

export const ferryStatsQuerySchema = z.object({
  /** The year a crossing LEFT in, on its departure port's calendar. */
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  /** "MM-DD": the last day of that year to count — the same span of a running year. */
  until: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
    .optional(),
});

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = ferryStatsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400, "VALIDATION_FAILED");
    if (parsed.data.until !== undefined && parsed.data.year === undefined) {
      throw new AppError("until needs a year", 400, "VALIDATION_FAILED");
    }
    const data = await loadFerryStats(
      req.userId!,
      parsed.data.year ?? null,
      parsed.data.until ?? null
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;
