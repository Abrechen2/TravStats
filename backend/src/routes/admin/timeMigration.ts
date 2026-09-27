import { Router, Response, NextFunction } from "express";

import { AppError } from "../../middleware/errorHandler";
import { AuthRequest } from "../../middleware/auth";
import { reResolveApplyBodySchema, reResolveQuerySchema } from "../../schemas/timeMigration";
import { findRunningJob, startJob, type JobKind } from "../../services/jobs/jobRegistry";
import { buildTimeMigrationReport } from "../../services/timeMigration/report";
import {
  applyReResolve,
  requireDryRun,
  reResolveDryRun,
} from "../../services/timeMigration/reResolve";

/**
 * The time-model migration, admin side (ADR 0002 phase 3b). Bare family —
 * the report is the resource itself, a started job answers `{jobId}`.
 * Mounted under `/admin`, so `requireAdmin` and the write-scope guard in
 * `admin/index.ts` apply.
 */
const router = Router();

/** One writer of stored zones at a time: the backfill and both re-resolution steps. */
const ZONE_JOBS: readonly JobKind[] = [
  "timeModel.backfill",
  "timeZones.reResolveDryRun",
  "timeZones.reResolveApply",
];

function refuseWhileRunning(): void {
  if (findRunningJob(ZONE_JOBS)) {
    throw new AppError(
      "A zone re-resolution or the backfill is running",
      409,
      "RE_RESOLVE_RUNNING"
    );
  }
}

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

router.post("/time-zones/re-resolve", (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Only the dry run lives here; applying is its own endpoint and needs its id.
    reResolveQuerySchema.parse(req.query);
    refuseWhileRunning();
    const job = startJob("timeZones.reResolveDryRun", req.userId!, () => reResolveDryRun());
    res.status(202).json({ jobId: job.id });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/time-zones/re-resolve/apply",
  (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { dryRunId } = reResolveApplyBodySchema.parse(req.body);
      requireDryRun(dryRunId);
      refuseWhileRunning();
      const job = startJob("timeZones.reResolveApply", req.userId!, () => applyReResolve(dryRunId));
      res.status(202).json({ jobId: job.id });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
