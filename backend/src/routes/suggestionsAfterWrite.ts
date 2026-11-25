import { Router, type NextFunction, type Request, type Response } from "express";

import type { AuthRequest } from "../middleware/auth";
import { queueSuggestionReconcile } from "../services/suggestions/reconcile";

/**
 * Re-judge the pending place suggestions after every write that can cover one
 * (forgejo#439): a place visit, a lodging stay, a flight, a trip's dates. A
 * photo finding or GPS stay used to stay `pending` long after the visit that
 * answers it was logged — the reconcile ran only at the next scan.
 *
 * The `dataQualityAfterCreate` pattern: one listener in front of the domain
 * routers (several of which are frozen at their size), answering nothing. It
 * waits for the write's response and, when it succeeded, queues a detached,
 * coalesced reconcile (`queueSuggestionReconcile`). A failed reconcile never
 * touches the write.
 */
const router = Router();

/**
 * The writes that can cover a suggestion, or take a cover away — exactly the
 * routes the domain routers serve, so the OpenAPI coverage test sees no
 * phantom endpoint.
 */
export const WRITE_ROUTES = {
  post: ["/places", "/places/:id/visits", "/lodging", "/lodging/:id/stays", "/flights", "/trips"],
  put: ["/flights/:id"],
  patch: [
    "/places/:id",
    "/places/visits/:visitId",
    "/lodging/:id",
    "/lodging/:id/stays/:stayId",
    "/trips/:id",
  ],
  delete: [
    "/places/:id",
    "/places/visits/:visitId",
    "/lodging/:id",
    "/lodging/:id/stays/:stayId",
    "/flights/:id",
    "/trips/:id",
  ],
} as const;

function afterWrite(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    const userId = (req as AuthRequest).userId;
    if (userId && res.statusCode >= 200 && res.statusCode < 300) {
      void queueSuggestionReconcile(userId);
    }
  });
  next();
}

router.post([...WRITE_ROUTES.post], afterWrite);
router.put([...WRITE_ROUTES.put], afterWrite);
router.patch([...WRITE_ROUTES.patch], afterWrite);
router.delete([...WRITE_ROUTES.delete], afterWrite);

export default router;
