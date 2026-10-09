import { Router, type NextFunction, type Response } from "express";

import { authenticate, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { placeRelations } from "../../services/places/placeRelations";

/**
 * `GET /places/:id/related` — what hangs off a place, counted: visits, proof
 * photos, kept documents, the lists it is in, the trips its visits are filed
 * under. The delete question names what goes and what stays from it
 * (forgejo#250); the merge preview shows what moves (forgejo#232).
 *
 * Own file on the places prefix, mounted before `places.ts` like its
 * siblings. Read-only, so no write scope. 404 for a place that is not the
 * caller's — the same answer as for one that does not exist.
 */
const router = Router();
router.use(authenticate);

router.get(
  "/:id/related",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) throw new AppError("Not authenticated", 401);
      const relations = await placeRelations(userId, req.params.id);
      if (!relations) throw new AppError("Place not found", 404);
      res.json({ success: true, data: relations });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
