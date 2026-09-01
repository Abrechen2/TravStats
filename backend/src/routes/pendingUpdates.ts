/**
 * Pending Updates Routes
 *
 * API endpoints for managing pending flight updates
 */

import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireWriteScope, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
  getPendingUpdates,
  getPendingUpdateById,
  applyPendingUpdate,
  rejectPendingUpdate,
  updatePendingUpdate,
  previewStatisticsImpact,
} from '../services/pendingUpdateService';
import { prisma } from '../db';
import logger from '../utils/logger';

const router = Router();

// No rate limiter. `/:id/preview` looks like the expensive one — it says
// "statistics impact" — but it computes that for ONE flight from data already
// on the pending row, resolving at most four airport codes through the
// in-process airport cache. Everything else is a single-row read or write
// scoped by `userId`. The expensive half of this feature is the enrichment
// that CREATES pending updates, and that runs in a scheduled job and behind
// `flightLookup.ts`, which is limited because it spends an external API quota.

// All routes require authentication
router.use(authenticate);
// Method-aware: GET passes through, so read-only PATs keep read access but
// cannot apply/edit/reject/delete — applying MUTATES the underlying flight.
// Consistent with routes/flights.ts and routes/lodging.ts.
router.use(requireWriteScope);

// Schema for updating pending update
const updatePendingUpdateSchema = z.object({
  editedData: z.object({
    airline: z.string().optional(),
    aircraft: z.string().optional(),
    gate: z.string().optional(),
    terminal: z.string().optional(),
    depIata: z.string().optional(),
    depIcao: z.string().optional(),
    arrIata: z.string().optional(),
    arrIcao: z.string().optional(),
    departureTime: z.string().optional(),
    arrivalTime: z.string().optional(),
  }).optional(),
});

/**
 * Bulk apply / reject.
 *
 * Every action here was per-id, and the review page held a single selected id,
 * so accepting a refresh that produced fifty proposals cost fifty clicks and
 * fifty round trips (Forgejo #33). The refresh is a batch operation; the review
 * was not, which made the feature slower to use exactly as it became more
 * useful.
 *
 * The response reports an outcome PER ID rather than one success flag. Some
 * proposals will fail — a flight edited in the meantime, a proposal already
 * applied, an id that is not yours — and collapsing that into a single boolean
 * would silently drop changes the user believes they accepted. Partial success
 * is the normal case here, not an error case.
 *
 * The cap is deliberate. `historicalEnrichmentMaxPerDay` defaults to 50, so 200
 * is generous for real use while keeping one request from turning into an
 * unbounded transaction.
 */
const bulkIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

type BulkOutcome = { id: string; status: 'applied' | 'rejected' | 'failed'; error?: string };

async function runBulk(
  ids: string[],
  userId: string,
  action: 'apply' | 'reject'
): Promise<BulkOutcome[]> {
  const results: BulkOutcome[] = [];
  // Sequential on purpose: applying mutates the underlying flight, and running
  // these in parallel would put dozens of writes on the pool at once for no
  // gain a person can perceive.
  for (const id of ids) {
    try {
      const existing = await getPendingUpdateById(id, userId);
      if (!existing) {
        results.push({ id, status: 'failed', error: 'Not found' });
        continue;
      }
      if (action === 'apply') {
        const flight = await applyPendingUpdate(id, userId);
        results.push(
          flight
            ? { id, status: 'applied' }
            : { id, status: 'failed', error: 'Could not be applied' }
        );
      } else {
        const ok = await rejectPendingUpdate(id, userId);
        results.push(
          ok ? { id, status: 'rejected' } : { id, status: 'failed', error: 'Could not be rejected' }
        );
      }
    } catch (error) {
      results.push({
        id,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  return results;
}

// Bulk apply — registered before the /:id routes so the literal path wins
router.post('/apply', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { ids } = bulkIdsSchema.parse(req.body);
    const results = await runBulk(ids, userId, 'apply');
    const applied = results.filter((r) => r.status === 'applied').length;

    logger.info({
      operation: 'bulk_apply_pending_updates',
      message: 'Pending updates applied in bulk',
      context: { userId, requested: ids.length, applied, failed: ids.length - applied },
    });

    res.json({ requested: ids.length, applied, failed: ids.length - applied, results });
  } catch (error) {
    next(error);
  }
});

// Bulk reject
router.post('/reject', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { ids } = bulkIdsSchema.parse(req.body);
    const results = await runBulk(ids, userId, 'reject');
    const rejected = results.filter((r) => r.status === 'rejected').length;

    logger.info({
      operation: 'bulk_reject_pending_updates',
      message: 'Pending updates rejected in bulk',
      context: { userId, requested: ids.length, rejected, failed: ids.length - rejected },
    });

    res.json({ requested: ids.length, rejected, failed: ids.length - rejected, results });
  } catch (error) {
    next(error);
  }
});

// Get all pending updates for the authenticated user
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { status, flightId } = req.query;

    const filters: { status?: string; flightId?: string } = {};
    if (status) filters.status = status as string;
    if (flightId) filters.flightId = flightId as string;

    const updates = await getPendingUpdates(userId, filters);

    res.json({
      updates,
      count: updates.length,
    });
  } catch (error) {
    next(error);
  }
});

// Get statistics for pending updates
router.get('/statistics', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    const stats = await prisma.pendingUpdateStatistics.findUnique({
      where: { userId },
    });

    if (!stats) {
      return res.json({
        totalUpdates: 0,
        appliedUpdates: 0,
        rejectedUpdates: 0,
        editedUpdates: 0,
        expiredUpdates: 0,
        mostChangedFields: {},
        averageUpdateTime: null,
      });
    }

    res.json({
      totalUpdates: stats.totalUpdates,
      appliedUpdates: stats.appliedUpdates,
      rejectedUpdates: stats.rejectedUpdates,
      editedUpdates: stats.editedUpdates,
      expiredUpdates: stats.expiredUpdates,
      mostChangedFields: stats.mostChangedFields,
      averageUpdateTime: stats.averageUpdateTime,
    });
  } catch (error) {
    next(error);
  }
});

// Get a single pending update by ID
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const update = await getPendingUpdateById(id, userId);

    if (!update) {
      throw new AppError('Pending update not found', 404);
    }

    res.json(update);
  } catch (error) {
    next(error);
  }
});

// Update a pending update (edit it)
router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const data = updatePendingUpdateSchema.parse(req.body);

    if (!data.editedData) {
      throw new AppError('editedData is required', 400);
    }

    const updated = await updatePendingUpdate(id, userId, data.editedData);

    if (!updated) {
      throw new AppError('Failed to update pending update', 500);
    }

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError('Invalid request data', 400));
    }
    next(error);
  }
});

// Preview statistics impact
router.post('/:id/preview', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const parsedBody = updatePendingUpdateSchema.parse({ editedData: req.body.editedData });
    const parsedEditedData = (parsedBody.editedData ?? {}) as Record<string, unknown>;

    const impact = await previewStatisticsImpact(id, userId, parsedEditedData);

    if (!impact) {
      throw new AppError('Failed to calculate statistics impact', 500);
    }

    res.json(impact);
  } catch (error) {
    next(error);
  }
});

// Apply a pending update
router.post('/:id/apply', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const existing = await getPendingUpdateById(id, userId);
    if (!existing) {
      throw new AppError('Pending update not found', 404);
    }

    const flight = await applyPendingUpdate(id, userId);

    if (!flight) {
      throw new AppError('Failed to apply pending update', 500);
    }

    logger.info({
      operation: 'apply_pending_update_api',
      message: 'Pending update applied via API',
      context: {
        pendingUpdateId: id,
        userId,
        flightId: flight.id,
      },
    });

    res.json({
      success: true,
      flight,
    });
  } catch (error) {
    next(error);
  }
});

// Reject a pending update
router.post('/:id/reject', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const success = await rejectPendingUpdate(id, userId);

    if (!success) {
      throw new AppError('Failed to reject pending update', 500);
    }

    logger.info({
      operation: 'reject_pending_update_api',
      message: 'Pending update rejected via API',
      context: {
        pendingUpdateId: id,
        userId,
      },
    });

    res.json({
      success: true,
    });
  } catch (error) {
    next(error);
  }
});

// Delete a pending update
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    // Verify ownership
    const update = await getPendingUpdateById(id, userId);
    if (!update) {
      throw new AppError('Pending update not found', 404);
    }

    await prisma.pendingFlightUpdate.delete({
      where: { id, userId },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
