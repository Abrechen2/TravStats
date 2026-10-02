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

const query = z.object({ year: z.coerce.number().int().min(1900).max(2200).optional() });

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = query.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400, "RENTAL_INVALID_QUERY");
    const data = await rentalStatsFor(req.userId as string, parsed.data.year ?? null);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;
