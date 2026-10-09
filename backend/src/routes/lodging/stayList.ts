import { Router, type NextFunction, type Response } from "express";

import { type AuthRequest, requireUser } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { stayListQuerySchema } from "../../schemas/lodging";
import { queryStayPage, STAY_LIST_DEFAULT_LIMIT } from "../../services/lodging/stayList";

/**
 * `GET /lodging/stays` - every stay of the account in check-in order, across
 * houses (forgejo#226), optionally narrowed to a window or a trip.
 *
 * Mounted inside the lodging router BEFORE `/:id`, which would otherwise read
 * "stays" as a lodging id. The envelope is the lodging router's:
 * `{ success, data, meta: { total, limit, offset } }`.
 */
const router = Router();

router.get("/stays", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = requireUser(req);
    const parsed = stayListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const { total, rows } = await queryStayPage(userId, parsed.data);
    res.json({
      success: true,
      data: rows,
      meta: {
        total,
        limit: parsed.data.limit ?? STAY_LIST_DEFAULT_LIMIT,
        offset: parsed.data.offset ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
