import { Router, type NextFunction, type Response } from "express";

import { prisma } from "../../db";
import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { mergePlaceSchema } from "../../schemas/place";
import { mergePlaces } from "../../services/places/placeMerge";
import { recheckAchievements } from "../../utils/achievements";
import logger from "../../utils/logger";
import { PLACE_INCLUDE, decorate } from "../places";

/**
 * `POST /places/:id/merge` — fold a duplicate (`sourceId`) into the place
 * `:id`, with the master data the user picked, in one transaction
 * (forgejo#232; the rules are in `services/places/placeMerge.ts`). Answers with
 * the place that stays, decorated like `GET /places/:id` minus the photos.
 *
 * Own file on the places prefix, mounted before `places.ts` like its siblings.
 * No rate limiter, for the reason `places.ts` gives: per-user writes over the
 * caller's own rows, bounded by them.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

router.post(
  "/:id/merge",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) throw new AppError("Not authenticated", 401);
      const parsed = mergePlaceSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);

      const moved = await mergePlaces(userId, req.params.id, parsed.data);
      logger.info(
        { operation: "place_merge", targetId: req.params.id, moved },
        "two places merged into one"
      );
      await recheckAchievements(userId, "place merge");

      const place = await prisma.place.findFirst({
        where: { id: req.params.id, userId },
        include: PLACE_INCLUDE,
      });
      if (!place) throw new AppError("Place not found", 404);
      res.json({ success: true, data: decorate(place) });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
