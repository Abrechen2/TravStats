import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { diagnosticExportLimiter } from '../middleware/rateLimit';
import { buildDiagnosticsBundle } from '../services/diagnosticsBundle';
import logger from '../utils/logger';

const router = Router();

const splitMaybeArray = (v: unknown): string[] | undefined => {
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
};

const querySchema = z.object({
  flightIds: z.string().optional(),
  tripIds: z.string().optional(),
  airline: z.string().optional(),
  since: z.string().datetime().optional(),
});

/**
 * GET /api/v1/diagnostics
 *
 * User-scoped data snapshot for bug reports (issue #105). Distinct from
 * /diagnostic-export (which returns server log tails). Maintainers paste
 * the response into the "Diagnostic bundle" section of the bug template.
 *
 * Filters (all optional, all combined with AND):
 *   ?flightIds=uuid,uuid,uuid
 *   ?tripIds=uuid,uuid
 *   ?airline=Iberia
 *   ?since=2026-05-09T15:00:00Z
 *
 * `recentErrors` is reserved for v1.5.x — see issue #105 discussion.
 */
router.get(
  '/diagnostics',
  authenticate,
  diagnosticExportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = querySchema.parse(req.query);
      const filters = {
        flightIds: splitMaybeArray(parsed.flightIds),
        tripIds: splitMaybeArray(parsed.tripIds),
        airline: parsed.airline?.trim() || undefined,
        since: parsed.since ? new Date(parsed.since) : undefined,
      };
      const bundle = await buildDiagnosticsBundle(req.userId!, filters);
      logger.info({
        operation: 'diagnostics_bundle',
        userId: req.userId,
        context: {
          flightCount: bundle.counts.flights,
          tripCount: bundle.counts.trips,
          hasFilters: !!(filters.flightIds || filters.tripIds || filters.airline || filters.since),
        },
      });
      res.json(bundle);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
