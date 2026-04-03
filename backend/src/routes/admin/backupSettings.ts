import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { updateSchedule } from '../../services/backupScheduler';
import logger from '../../utils/logger';

const backupSettingsSchema = z.object({
  backupEnabled: z.boolean().optional(),
  backupInterval: z.enum(['daily', 'weekly', 'monthly']).optional(),
  backupRetentionDays: z.number().int().min(1).max(365).optional(),
});

const router = Router();

router.get('/backup-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminSettings = await prisma.adminSettings.findFirst();
    res.json({
      backupEnabled: adminSettings?.backupEnabled ?? false,
      backupInterval: adminSettings?.backupInterval ?? 'weekly',
      backupRetentionDays: adminSettings?.backupRetentionDays ?? 30,
    });
  } catch (error) {
    next(error);
  }
});

router.put('/backup-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { backupEnabled, backupInterval, backupRetentionDays } = backupSettingsSchema.parse(req.body);

    let adminSettings = await prisma.adminSettings.findFirst();

    const updateData: {
      backupEnabled?: boolean;
      backupInterval?: string;
      backupRetentionDays?: number;
    } = {};

    if (backupEnabled !== undefined) updateData.backupEnabled = backupEnabled;
    if (backupInterval !== undefined) updateData.backupInterval = backupInterval;
    if (backupRetentionDays !== undefined) updateData.backupRetentionDays = backupRetentionDays;

    if (adminSettings) {
      adminSettings = await prisma.adminSettings.update({
        where: { id: adminSettings.id },
        data: updateData,
      });
    } else {
      adminSettings = await prisma.adminSettings.create({
        data: {
          allowUserApiKeys: true,
          allowUserFlightApiKeys: true,
          defaultVisionParser: 'auto',
          defaultTextParser: 'auto',
          ...updateData,
        },
      });
    }

    await updateSchedule();

    logger.info({ operation: 'backup_settings_updated', context: updateData });

    res.json({
      message: 'Backup settings updated',
      backupEnabled: adminSettings.backupEnabled,
      backupInterval: adminSettings.backupInterval,
      backupRetentionDays: adminSettings.backupRetentionDays,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
