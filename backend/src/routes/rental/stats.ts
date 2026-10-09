import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { authenticate, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { rentalStatsFor } from "../../services/rental/rentalStats";

/**
 * GET /api/v1/rentals/stats — the rental figures (spec
 * 2026-10-01-rental-domain-design §7.4). Mounted ahead of the rental router,
 * whose `/:id` would otherwise take "stats" for a rental id.
 */
const router = Router();
router.use(authenticate);

export const rentalStatsQuerySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  /** "MM-DD": the last day of that year to count — the same span of a running year. */
  until: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
    .optional(),
});

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = rentalStatsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400, "RENTAL_INVALID_QUERY");
    if (parsed.data.until !== undefined && parsed.data.year === undefined) {
      throw new AppError("until needs a year", 400, "RENTAL_INVALID_QUERY");
    }
    const data = await rentalStatsFor(
      req.userId as string,
      parsed.data.year ?? null,
      parsed.data.until ?? null
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;
