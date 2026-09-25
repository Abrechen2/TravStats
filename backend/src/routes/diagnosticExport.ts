import { Router, Response, NextFunction } from "express";
import { authenticate, AuthRequest, requireAdmin } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { diagnosticExportLimiter } from "../middleware/rateLimit";
import { buildDiagnosticBundle } from "../services/diagnosticExport";
import logger from "../utils/logger";

const router = Router();

/**
 * GET /api/v1/diagnostic-export
 *
 * Returns a PII-scrubbed JSON bundle an admin can attach to a GitHub issue.
 * Authenticated (the endpoint reads server log files, which are not public),
 * rate-limited, and never persisted. The bundle's identity has been stripped
 * so the reader of the issue sees no user IDs, IPs, emails, tokens, etc.
 *
 * Refused for the SHARED demo account (independent review, 2026-09-17,
 * finding A1). The bundle is server-wide, not caller-scoped: the log tails
 * carry every account's activity, and the scrubber removes identity, not
 * content — flight numbers, routes and timestamps survive it. On a public
 * instance the demo password is printed on the login page, so without this
 * the whole instance's log is one authenticated GET away from anybody.
 * `rejectDemo`, not `rejectDemoWrites`: this is a GET, and reading is
 * precisely the harm. It sits ABOVE the limiter so a refusal costs no bucket.
 *
 * Admins only (owner decision, 2026-09-25). The demo refusal alone left every
 * ordinary account able to download every OTHER account's scrubbed activity;
 * an instance's logs belong to whoever runs the instance. `rejectDemo` stays
 * in front so the shared login keeps its own, explicit refusal code. The
 * user-scoped `/diagnostics` snapshot is the caller's own data and stays open.
 */
router.get(
  "/diagnostic-export",
  authenticate,
  rejectDemo,
  requireAdmin,
  diagnosticExportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const bundle = await buildDiagnosticBundle(req.userId!);
      logger.info({
        operation: "diagnostic_export",
        userId: req.userId,
        context: {
          appTailSize: bundle.logs.appTail.length,
          errorTailSize: bundle.logs.errorTail.length,
        },
      });

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="travstats-diagnostic-${Date.now()}.json"`
      );
      res.json(bundle);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
