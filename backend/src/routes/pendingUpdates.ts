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
