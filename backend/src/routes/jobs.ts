/**
 * GET /api/v1/jobs/:id — the state of a background job this caller started.
 *
 * The other half of `services/jobs/jobRegistry.ts`: a long-running request
 * answers 202 with a job id, and the client polls here until the job has an
 * outcome. A job belonging to someone else answers 404, exactly like one that
 * never existed. Enveloped response family.
 */

import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { authenticate, AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { getJob } from "../services/jobs/jobRegistry";

const router = Router();

const params = z.object({ id: z.string().uuid() });

router.get("/:id", authenticate, (req: AuthRequest, res: Response, next: NextFunction): void => {
  try {
    const parsed = params.safeParse(req.params);
    if (!parsed.success) throw new AppError("Job not found", 404);
    const job = getJob(parsed.data.id, req.userId!);
    if (!job) throw new AppError("Job not found", 404);
    res.json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
});

export default router;
