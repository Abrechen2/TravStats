import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { patAwareMax, userOrIpKey } from "../middleware/rateLimit";
import { answerInBulk, bulkBodySchema } from "../services/inbox/bulk";

/**
 * `POST /api/v1/inbox/bulk` (owner 2026-11-26): answer a trip's, a period's or a source's inbox
 * items at once through each kind's own accept/reject. Always 200 for a valid body: the outcome
 * is per item (done / skipped / failed with its reason). Enveloped family `{ success, data }`.
 */
const router = Router();
router.use(authenticate, requireWriteScope);

/** A bulk answer touches up to 200 records: a few a minute is a person working through a trip. */
const bulkLimiter = rateLimit({
  windowMs: 60_000,
  max: patAwareMax(10),
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/bulk", rejectDemo, bulkLimiter, async (req: AuthRequest, res, next) => {
  try {
    if (!req.userId) throw new AppError("Not authenticated", 401);
    const results = await answerInBulk(req.userId, bulkBodySchema.parse(req.body));
    const count = (o: string) => results.filter((r) => r.outcome === o).length;
    res.json({
      success: true,
      data: {
        results,
        summary: { done: count("done"), skipped: count("skipped"), failed: count("failed") },
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
