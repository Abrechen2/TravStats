import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import logger from '../../utils/logger';
import { DeveloperModeUpdateData, defaultSettings } from './types';

const router = Router();

const developerModeSchema = z.object({
  enabled: z.boolean(),
  confirmed: z.boolean().optional(),
});

// Developer-mode requires admin privileges
router.use(async (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    if (!req.userId) throw new AppError('Unauthorized', 401);
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { isAdmin: true, isActive: true },
    });
    if (!user || !user.isActive) throw new AppError('Forbidden', 403);
    if (!user.isAdmin) throw new AppError('Admin access required', 403);
    next();
  } catch (error) {
    next(error);
  }
});

// GET /
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        developerModeEnabled: true,
        developerModeConfirmedAt: true,
      },
    });

    res.json({
      enabled: settings?.developerModeEnabled ?? false,
      confirmedAt: settings?.developerModeConfirmedAt ?? null,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /
router.put('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const payload = developerModeSchema.parse(req.body);

    // If enabling, require confirmation
    if (payload.enabled && !payload.confirmed) {
      res.status(400).json({
        error: 'Confirmation required to enable developer mode',
        message: 'You must confirm that you understand the risks before enabling developer mode.',
      });
      return;
    }

    const updateData: DeveloperModeUpdateData = {
      developerModeEnabled: payload.enabled,
    };

    if (payload.enabled && payload.confirmed) {
      updateData.developerModeConfirmedAt = new Date();
    } else if (!payload.enabled) {
      updateData.developerModeConfirmedAt = null;
    }

    await prisma.userSettings.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        data: defaultSettings,
        ...updateData,
      },
    });

    logger.info({
      operation: 'developer_mode_updated',
      message: 'Developer mode updated',
      context: {
        userId,
        enabled: payload.enabled,
      },
    });

    res.json({
      message: 'Developer mode updated successfully',
      enabled: payload.enabled,
      confirmedAt: payload.enabled ? new Date() : null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
