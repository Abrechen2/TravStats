import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { diagnosticExportLimiter } from '../middleware/rateLimit';
import { buildDiagnosticBundle } from '../services/diagnosticExport';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/v1/diagnostic-export
 *
 * Returns a PII-scrubbed JSON bundle the user can paste into a GitHub issue.
 * Authenticated (the endpoint reads server log files, which are not public),
 * rate-limited, and never persisted. The bundle's identity has been stripped
 * so the reader of the issue sees no user IDs, IPs, emails, tokens, etc.
 */
router.get(
  '/diagnostic-export',
  authenticate,
  diagnosticExportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const bundle = await buildDiagnosticBundle(req.userId!);
      logger.info({
        operation: 'diagnostic_export',
        userId: req.userId,
        context: {
          appTailSize: bundle.logs.appTail.length,
          errorTailSize: bundle.logs.errorTail.length,
        },
      });

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="travstats-diagnostic-${Date.now()}.json"`,
      );
      res.json(bundle);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
