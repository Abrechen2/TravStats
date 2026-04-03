import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import logger from '../../utils/logger';
import { TrainingSettingsUpdateData, defaultSettings } from './types';

const router = Router();

const trainingSettingsSchema = z.object({
  useTrainedModels: z.boolean().optional(),
  preferredEmailModel: z.enum(['auto', 'trained', 'base']).optional(),
  preferredVisionModel: z.enum(['auto', 'trained', 'base']).optional(),
});

// GET /
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        useTrainedModels: true,
        preferredEmailModel: true,
        preferredVisionModel: true,
      },
    });

    res.json({
      useTrainedModels: settings?.useTrainedModels ?? true,
      preferredEmailModel: settings?.preferredEmailModel ?? 'auto',
      preferredVisionModel: settings?.preferredVisionModel ?? 'auto',
    });
  } catch (error) {
    next(error);
  }
});

// PUT /
router.put('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const payload = trainingSettingsSchema.parse(req.body);

    const updateData: TrainingSettingsUpdateData = {};

    if (payload.useTrainedModels !== undefined) {
      updateData.useTrainedModels = payload.useTrainedModels;
    }
    if (payload.preferredEmailModel !== undefined) {
      updateData.preferredEmailModel = payload.preferredEmailModel;
    }
    if (payload.preferredVisionModel !== undefined) {
      updateData.preferredVisionModel = payload.preferredVisionModel;
    }

    const updated = await prisma.userSettings.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        data: defaultSettings,
        useTrainedModels: payload.useTrainedModels ?? true,
        preferredEmailModel: payload.preferredEmailModel ?? 'auto',
        preferredVisionModel: payload.preferredVisionModel ?? 'auto',
      },
      select: {
        useTrainedModels: true,
        preferredEmailModel: true,
        preferredVisionModel: true,
      },
    });

    logger.info({
      operation: 'training_settings_updated',
      message: 'Training settings updated',
      context: {
        userId,
        settings: updated,
      },
    });

    res.json({
      message: 'Training settings updated successfully',
      settings: updated,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
