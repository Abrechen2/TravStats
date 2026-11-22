import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { statsLimiter } from "../middleware/rateLimit";
import { PROVENANCE_ENTRY_TYPES, setProvenanceSchema } from "../schemas/provenance";
import {
  dismissProvenanceNotice,
  listProvenanceNotices,
  syncProvenanceNotices,
} from "../services/provenance/notices";
import { setProvenance } from "../services/provenance/setProvenance";

/**
 * `/api/v1/provenance` — "aus der Erinnerung" (docs/superpowers/specs/2026-11-22-remembered-facts.md).
 *
 * `PUT /:entryType/:id` marks one of the caller's entries remembered/recorded, or clears the mark.
 * `GET /notices` lists the recollections a record contradicts; `POST /notices/:id/dismiss` keeps
 * the user's answer. Own entries only. Enveloped.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const entryParams = z.object({
  entryType: z.enum(PROVENANCE_ENTRY_TYPES),
  id: z.string().uuid(),
});

router.put(
  "/:entryType/:id",
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { entryType, id } = entryParams.parse(req.params);
      const body = setProvenanceSchema.parse(req.body ?? {});
      const state = await setProvenance(req.userId!, entryType, id, body);
      if (!state) {
        res.status(404).json({ success: false, error: "Entry not found", code: "ENTRY_NOT_FOUND" });
        return;
      }
      await syncProvenanceNotices(req.userId!);
      res.json({ success: true, data: state });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/notices",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const notices = await listProvenanceNotices(req.userId!);
      res.json({ success: true, data: { notices, total: notices.length } });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/notices/:id/dismiss",
  rejectDemo,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      if (!(await dismissProvenanceNotice(req.userId!, id))) {
        res.status(404).json({
          success: false,
          error: "Nothing pending to dismiss",
          code: "PROVENANCE_NOTICE_NOT_FOUND",
        });
        return;
      }
      res.json({ success: true, data: { dismissed: true } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
