import { Router, Response, NextFunction } from "express";

import { AuthRequest } from "../../middleware/auth";
import { buildTimeMigrationReport } from "../../services/timeMigration/report";

/**
 * The time-model migration, admin side (ADR 0002 phase 3b). Bare family —
 * the report is the resource itself. Mounted under `/admin`, so `requireAdmin`
 * and the write-scope guard in `admin/index.ts` apply.
 */
const router = Router();

router.get(
  "/time-migration/report",
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await buildTimeMigrationReport());
    } catch (error) {
      next(error);
    }
  }
);

export default router;
