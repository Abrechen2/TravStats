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
 * Returns the diagnostic bundle an admin attaches to a public GitHub issue:
 * an allowlist of structured fields only (versions, platform, settings that
 * are booleans/numbers/enums, counts, migration status, and log events reduced
 * to time/level/category/event key/error code/`file:line`) — see
 * `services/diagnosticExport.ts`. Authenticated, rate-limited, never persisted.
 *
 * Refused for the SHARED demo account (independent review, 2026-09-17,
 * finding A1). The bundle is server-wide, not caller-scoped: the log tails
 * carry every account's activity, and the scrubber removes identity, not
 * content. (Since 2026-09-26 the bundle is an allowlist, but the refusal
 * stays: it is the shared account, and the log is still the instance's.) On a public
 * instance the demo password is printed on the login page, so without this
 * the whole instance's log is one authenticated GET away from anybody.
 * `rejectDemo`, not `rejectDemoWrites`: this is a GET, and reading is
 * precisely the harm. It sits ABOVE the limiter so a refusal costs no bucket.
 *
 * Admins only (owner decision, 2026-09-25). The demo refusal alone left every
 * ordinary account able to download every OTHER account's scrubbed activity;
 * an instance's logs belong to whoever runs the instance. `rejectDemo` stays
 * in front so the shared login keeps its own, explicit refusal code.
 */
router.get(
  "/diagnostic-export",
  authenticate,
  rejectDemo,
  requireAdmin,
  diagnosticExportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const bundle = await buildDiagnosticBundle();
      logger.info({
        operation: "diagnostic_export",
        userId: req.userId,
        context: {
          failedSections: Object.entries(bundle)
            .filter(([, value]) => (value as { status?: string })?.status === "failed")
            .map(([name]) => name),
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
