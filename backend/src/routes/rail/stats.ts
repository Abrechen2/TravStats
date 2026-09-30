import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { loadRailStats } from "../../services/rail/railStats";

/**
 * The rail statistics (spec 2026-09-25-rail-domain, phase 2b). Enveloped, as
 * the rest of the rail family. Mounted at /api/v1/rail/stats, ahead of the
 * rail router, whose `/:id` would otherwise take "stats" for a journey id.
 * Like every rail endpoint it answers whatever the beta switch says; the
 * switch hides the statistics tab, it is not a boundary.
 */
const router = Router();
router.use(authenticate);

export const railStatsQuerySchema = z.object({
  /** The year a ride LEFT in, on its departure station's calendar. */
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  /**
   * The last month-day of that year to count, inclusive ("09-26"). The
   * statistics page compares a running year with the SAME SPAN of the other
   * one (`lib/stats/comparisonWindow.ts`); without it the rail tab set eight
   * months against twelve (acceptance D11).
   */
  until: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
    .optional(),
});

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = railStatsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    if (parsed.data.until !== undefined && parsed.data.year === undefined) {
      throw new AppError("until needs a year", 400, "VALIDATION_FAILED");
    }
    const data = await loadRailStats(
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
