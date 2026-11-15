import { Router, Response, NextFunction } from "express";

import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { batchLimiter } from "../middleware/rateLimit";
import {
  BULK_EDIT_PATHS,
  domainBulkEditSchema,
  type BulkDomain,
  type DomainBulkEdit,
} from "../schemas/domainBulkEdit";
import { bulkEditDomain } from "../services/bulkEdit/domainBulkEdit";

/**
 * `POST /<domain>/bulk-edit` for rail, bus, ferry, rentals, cruises and stays
 * (forgejo#405 A4) — the flights bulk edit's contract (`routes/flights/
 * bulkEdit.ts`) on every other domain. One result per row; a partial failure is
 * named per row and only those are sent again. Enveloped, like every router of
 * these domains (ADR 0001). Mounted BEFORE the domain routers, whose `/:id`
 * routes would otherwise see "bulk-edit".
 */

const router = Router();

for (const [domain, path] of Object.entries(BULK_EDIT_PATHS) as Array<[BulkDomain, string]>) {
  const schema = domainBulkEditSchema(domain);
  const limiter = // One bucket per domain: a rail clean-up must not lock cruises out.
    batchLimiter("Too many bulk edits, please try again later");
  router.post(
    path,
    authenticate,
    requireWriteScope,
    limiter,
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const edit = schema.parse(req.body) as DomainBulkEdit;
        const results = await bulkEditDomain(req.userId!, domain, edit);
        const count = (status: string) => results.filter((r) => r.status === status).length;
        res.json({
          success: true,
          data: {
            results,
            summary: {
              updated: count("updated"),
              unchanged: count("unchanged"),
              failed: count("failed"),
            },
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );
}

export default router;
