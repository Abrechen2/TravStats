import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import logger from '../../utils/logger';

interface ParserSettingsUpdateData {
  allowUserApiKeys?: boolean;
  defaultVisionParser?: string;
  defaultTextParser?: string;
}

const parserSettingsSchema = z.object({
  allowUserApiKeys: z.boolean().optional(),
  defaultVisionParser: z.string().optional(),
  defaultTextParser: z.string().optional(),
});

// Training configuration schema
const trainingConfigSchema = z.object({
  trainingModelOutputDir: z.string().optional().nullable().refine(
    (val) => !val || (val.length > 0 && val.length <= 500 && /^[a-zA-Z0-9/._-]+$/.test(val)),
    { message: 'Invalid path format (max 500 chars, alphanumeric, /, ., _, - only)' }
  ),
  trainingEmailModelName: z.string().optional().nullable().refine(
    (val) => !val || (val.length > 0 && val.length <= 100 && /^[a-zA-Z0-9._-]+$/.test(val)),
    { message: 'Invalid model name format (max 100 chars, alphanumeric, ., _, - only)' }
  ),
  trainingVisionModelName: z.string().optional().nullable().refine(
    (val) => !val || (val.length > 0 && val.length <= 100 && /^[a-zA-Z0-9._-]+$/.test(val)),
    { message: 'Invalid model name format (max 100 chars, alphanumeric, ., _, - only)' }
  ),
});

const router = Router();

// Get admin parser settings
router.get('/parser-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let adminSettings = await prisma.adminSettings.findFirst();

    if (!adminSettings) {
      adminSettings = await prisma.adminSettings.create({
        data: {
          allowUserApiKeys: true,
          allowUserFlightApiKeys: true,
          defaultVisionParser: 'tesseract',
          defaultTextParser: 'regex',
        },
      });
    }

    res.json({
      globalAirlabsApiKey: undefined,
      globalAviationstackApiKey: undefined,
      globalOpenskyClientId: undefined,
      globalOpenskyClientSecret: undefined,
      allowUserApiKeys: adminSettings.allowUserApiKeys,
      allowUserFlightApiKeys: adminSettings.allowUserFlightApiKeys,
      defaultVisionParser: 'tesseract',
      defaultTextParser: 'regex',
    });
  } catch (error) {
    next(error);
  }
});

// Update admin parser settings
router.put('/parser-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { allowUserApiKeys, defaultVisionParser, defaultTextParser } =
      parserSettingsSchema.parse(req.body);

    let adminSettings = await prisma.adminSettings.findFirst();

    const updateData: ParserSettingsUpdateData = {};

    if (allowUserApiKeys !== undefined) {
      updateData.allowUserApiKeys = allowUserApiKeys;
    }
    if (defaultVisionParser !== undefined) {
      updateData.defaultVisionParser = defaultVisionParser;
    }
    if (defaultTextParser !== undefined) {
      updateData.defaultTextParser = defaultTextParser;
    }

    if (adminSettings) {
      adminSettings = await prisma.adminSettings.update({
        where: { id: adminSettings.id },
        data: updateData,
      });
    } else {
      adminSettings = await prisma.adminSettings.create({
        data: {
          allowUserApiKeys: allowUserApiKeys ?? true,
          allowUserFlightApiKeys: true,
          defaultVisionParser: 'tesseract',
          defaultTextParser: 'regex',
        },
      });
    }

    res.json({
      message: 'Parser settings updated successfully',
      settings: {
        allowUserApiKeys: adminSettings.allowUserApiKeys,
        defaultVisionParser: 'tesseract',
        defaultTextParser: 'regex',
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get training configuration
router.get('/training-config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminSettings = await prisma.adminSettings.findFirst();
    const trainingModelOutputDir = adminSettings?.trainingModelOutputDir
      || process.env.TRAINING_MODEL_OUTPUT_DIR || './data/training/models';
    const trainingEmailModelName = adminSettings?.trainingEmailModelName
      || process.env.TRAINING_EMAIL_MODEL_NAME || 'travstats-email-custom';
    const trainingVisionModelName = adminSettings?.trainingVisionModelName
      || process.env.TRAINING_VISION_MODEL_NAME || 'travstats-vision-custom';

    res.json({
      trainingModelOutputDir: adminSettings?.trainingModelOutputDir || null,
      trainingEmailModelName: adminSettings?.trainingEmailModelName || null,
      trainingVisionModelName: adminSettings?.trainingVisionModelName || null,
      currentTrainingModelOutputDir: trainingModelOutputDir,
      currentTrainingEmailModelName: trainingEmailModelName,
      currentTrainingVisionModelName: trainingVisionModelName,
      envTrainingModelOutputDir: process.env.TRAINING_MODEL_OUTPUT_DIR || './data/training/models',
      envTrainingEmailModelName: process.env.TRAINING_EMAIL_MODEL_NAME || 'travstats-email-custom',
      envTrainingVisionModelName: process.env.TRAINING_VISION_MODEL_NAME || 'travstats-vision-custom',
    });
  } catch (error) {
    next(error);
  }
});

// Update training configuration
router.put('/training-config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const payload = trainingConfigSchema.parse(req.body);

    const updateData: {
      trainingModelOutputDir?: string | null;
      trainingEmailModelName?: string | null;
      trainingVisionModelName?: string | null;
    } = {};

    if (payload.trainingModelOutputDir !== undefined) {
      updateData.trainingModelOutputDir = payload.trainingModelOutputDir || null;
    }
    if (payload.trainingEmailModelName !== undefined) {
      updateData.trainingEmailModelName = payload.trainingEmailModelName || null;
    }
    if (payload.trainingVisionModelName !== undefined) {
      updateData.trainingVisionModelName = payload.trainingVisionModelName || null;
    }

    let adminSettings = await prisma.adminSettings.findFirst();

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
          defaultVisionParser: 'tesseract',
          defaultTextParser: 'regex',
          ...updateData,
        },
      });
    }

    logger.info({
      operation: 'training_config_updated',
      message: 'Training configuration updated',
      context: { userId: req.userId, settings: updateData },
    });

    const currentTrainingModelOutputDir = adminSettings.trainingModelOutputDir
      || process.env.TRAINING_MODEL_OUTPUT_DIR || './data/training/models';
    const currentTrainingEmailModelName = adminSettings.trainingEmailModelName
      || process.env.TRAINING_EMAIL_MODEL_NAME || 'travstats-email-custom';
    const currentTrainingVisionModelName = adminSettings.trainingVisionModelName
      || process.env.TRAINING_VISION_MODEL_NAME || 'travstats-vision-custom';

    res.json({
      message: 'Training configuration updated successfully',
      settings: {
        trainingModelOutputDir: adminSettings.trainingModelOutputDir,
        trainingEmailModelName: adminSettings.trainingEmailModelName,
        trainingVisionModelName: adminSettings.trainingVisionModelName,
        currentTrainingModelOutputDir,
        currentTrainingEmailModelName,
        currentTrainingVisionModelName,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
