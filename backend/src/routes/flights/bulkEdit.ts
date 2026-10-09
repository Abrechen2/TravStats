import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { batchCreationLimiter } from "../../middleware/rateLimit";
import { flightBulkEditSchema } from "../../schemas/flightBulkEdit";
import { bulkEditFlights } from "../../services/flights/bulkEdit";

/**
 * `POST /api/v1/flights/bulk-edit` — trip, tags and companions over an
 * explicit selection of flights (forgejo#217). One result per flight, so a
 * partial failure is named per flight and only those are sent again; see
 * `services/flights/bulkEdit.ts`. Bare, like every flights router (ADR 0001).
 * Mounted BEFORE flights.ts, whose routes would otherwise see "bulk-edit".
 */

const router = Router();

router.post(
  "/bulk-edit",
  authenticate,
  requireWriteScope,
  batchCreationLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const edit = flightBulkEditSchema.parse(req.body);
      const results = await bulkEditFlights(req.userId!, edit);
      const count = (status: string) => results.filter((r) => r.status === status).length;
      res.json({
        results,
        summary: {
          updated: count("updated"),
          unchanged: count("unchanged"),
          failed: count("failed"),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
