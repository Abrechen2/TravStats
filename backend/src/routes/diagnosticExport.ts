import { Router, Response, NextFunction } from "express";
import { authenticate, AuthRequest, requireUser } from "../middleware/auth";
import { rejectDemo } from "../middleware/demoGuard";
import { diagnosticExportLimiter } from "../middleware/rateLimit";
import { prisma } from "../db";
import { buildDiagnosticBundle, buildUserDiagnosticBundle } from "../services/diagnosticExport";
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
 * Two scopes (owner decision, 2026-11-05; it was admin-only from 2026-09-25).
 * An admin gets the server-wide package. Every other account gets a package of
 * its OWN data only — its row counts, its domain switches and the log lines
 * written on its behalf — with no instance settings, runtime or database
 * section, so no other account's activity and nothing about the host. An admin
 * API token without the admin scope is treated like an ordinary account.
 * `rejectDemo` stays in front so the shared login keeps its explicit refusal.
 */
router.get(
  "/diagnostic-export",
  authenticate,
  rejectDemo,
  diagnosticExportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = requireUser(req);
      const account = await prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      });
      const serverWide =
        account?.isAdmin === true && (!req.apiToken || req.apiToken.scope === "admin");
      const bundle = serverWide
        ? await buildDiagnosticBundle()
        : await buildUserDiagnosticBundle(userId);
      logger.info({
        operation: "diagnostic_export",
        userId,
        context: {
          scope: bundle.scope,
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
