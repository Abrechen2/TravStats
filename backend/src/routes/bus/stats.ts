import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { loadBusStats } from "../../services/bus/busStats";

/**
 * GET /api/v1/bus/stats — the bus statistics (spec 2026-10-07-bus-domain-design
 * §6, package B2; forgejo#263). Enveloped, as the rest of the bus family.
 * Mounted ahead of the bus router, whose `/:id` would otherwise take "stats"
 * for a ride id. Like every bus endpoint it answers whatever the beta switch
 * says; the switch hides the statistics tab, it is not a boundary.
 */
const router = Router();
router.use(authenticate);

export const busStatsQuerySchema = z.object({
  /** The year a ride LEFT in, on its departure terminal's calendar. */
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  /** "MM-DD": the last day of that year to count — the same span of a running year. */
  until: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
    .optional(),
});

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = busStatsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400, "VALIDATION_FAILED");
    if (parsed.data.until !== undefined && parsed.data.year === undefined) {
      throw new AppError("until needs a year", 400, "VALIDATION_FAILED");
    }
    const data = await loadBusStats(
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
