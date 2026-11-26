import { Router, Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth";
import { runtimeReport } from "../../services/runtime/runtimeStats";

/**
 * GET /admin/runtime — event-loop delay, memory, the database pool and ping,
 * the slowest statements (pg_stat_statements when enabled), the job slots and
 * the most recent slow requests and queries (perf audit 2026-11, item 4).
 * Mounted behind the admin router's authentication and admin gate.
 */
const router = Router();

router.get("/runtime", async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await runtimeReport());
  } catch (error) {
    next(error);
  }
});

export default router;
