import { Router, type NextFunction, type Response } from "express";

import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { activityFeedQuerySchema } from "../schemas/activityFeed";
import { loadActivityFeed, InvalidFeedCursorError } from "../services/activityFeed/feed";

/**
 * `GET /activity/feed` — the dashboard's "Aktivität" list: every entry of every
 * domain the account may see, newest first (planned ones on top), cursor-paged.
 * Owner-scoped and bounded; see `services/activityFeed/types.ts` for the order.
 *
 * No dedicated limiter, for the reason `upcoming.ts` gives: it sits on the
 * dashboard's render path, and a page is a handful of indexed `take`d queries.
 */
const router = Router();
router.use(authenticate);

router.get("/feed", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = activityFeedQuerySchema.safeParse(req.query);
    if (!parsed.success)
      throw new AppError(parsed.error.issues[0]?.message ?? "Invalid query", 400);
    const data = await loadActivityFeed(req.userId!, parsed.data);
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof InvalidFeedCursorError) return next(new AppError(err.message, 400));
    next(err);
  }
});

export default router;
