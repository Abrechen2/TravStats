import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { decryptApiKey, encryptApiKey } from '../../utils/encryption';
import logger from '../../utils/logger';

interface ParserSettingsUpdateData {
  globalOpenaiApiKey?: string | null;
  globalClaudeApiKey?: string | null;
  allowUserApiKeys?: boolean;
  defaultVisionParser?: string;
  defaultTextParser?: string;
  ollamaUrl?: string | null;
  ollamaModel?: string | null;
  ollamaVisionModel?: string | null;
}

const parserSettingsSchema = z.object({
  globalOpenaiApiKey: z.string().nullable().optional(),
  globalClaudeApiKey: z.string().nullable().optional(),
  allowUserApiKeys: z.boolean().optional(),
  defaultVisionParser: z.string().optional(),
  defaultTextParser: z.string().optional(),
  ollamaUrl: z.string().url().nullable().optional().or(z.literal("").transform(() => null)),
  ollamaModel: z.string().max(100).nullable().optional(),
  ollamaVisionModel: z.string().max(100).nullable().optional(),
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
    // Get or create admin settings (ID is always 1 for singleton)
    let adminSettings = await prisma.adminSettings.findFirst();

    if (!adminSettings) {
      // Create default admin settings if they don't exist
      adminSettings = await prisma.adminSettings.create({
        data: {
          allowUserApiKeys: true,
          allowUserFlightApiKeys: true,
          defaultVisionParser: 'auto',
          defaultTextParser: 'auto',
        },
      });
    }

    // Return settings (API keys are decrypted for frontend)
    res.json({
      globalOpenaiApiKey: decryptApiKey(adminSettings.globalOpenaiApiKey) || undefined,
      globalClaudeApiKey: decryptApiKey(adminSettings.globalClaudeApiKey) || undefined,
      globalAirlabsApiKey: decryptApiKey(adminSettings.globalAirlabsApiKey) || undefined,
      globalAviationstackApiKey: decryptApiKey(adminSettings.globalAviationstackApiKey) || undefined,
      globalOpenskyClientId: decryptApiKey(adminSettings.globalOpenskyClientId) || undefined,
      globalOpenskyClientSecret: decryptApiKey(adminSettings.globalOpenskyClientSecret) || undefined,
      allowUserApiKeys: adminSettings.allowUserApiKeys,
      allowUserFlightApiKeys: adminSettings.allowUserFlightApiKeys,
      defaultVisionParser: adminSettings.defaultVisionParser,
      defaultTextParser: adminSettings.defaultTextParser,
      ollamaUrl: adminSettings.ollamaUrl || process.env.OLLAMA_URL || null,
      ollamaModel: adminSettings.ollamaModel || process.env.OLLAMA_MODEL || null,
      ollamaVisionModel: adminSettings.ollamaVisionModel || process.env.OLLAMA_VISION_MODEL || null,
    });
  } catch (error) {
    next(error);
  }
});

// Update admin parser settings
router.put('/parser-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      globalOpenaiApiKey,
      globalClaudeApiKey,
      allowUserApiKeys,
      defaultVisionParser,
      defaultTextParser,
      ollamaUrl,
      ollamaModel,
      ollamaVisionModel,
    } = parserSettingsSchema.parse(req.body);

    // Get or create admin settings
    let adminSettings = await prisma.adminSettings.findFirst();

    const updateData: ParserSettingsUpdateData = {};

    // Only update fields that are provided
    // Encrypt API keys before storing
    if (globalOpenaiApiKey !== undefined) {
      updateData.globalOpenaiApiKey = encryptApiKey(globalOpenaiApiKey);
    }
    if (globalClaudeApiKey !== undefined) {
      updateData.globalClaudeApiKey = encryptApiKey(globalClaudeApiKey);
    }
    if (allowUserApiKeys !== undefined) {
      updateData.allowUserApiKeys = allowUserApiKeys;
    }
    if (defaultVisionParser !== undefined) {
      updateData.defaultVisionParser = defaultVisionParser;
    }
    if (defaultTextParser !== undefined) {
      updateData.defaultTextParser = defaultTextParser;
    }
    if (ollamaUrl !== undefined) {
      updateData.ollamaUrl = ollamaUrl;
    }
    if (ollamaModel !== undefined) {
      updateData.ollamaModel = ollamaModel;
    }
    if (ollamaVisionModel !== undefined) {
      updateData.ollamaVisionModel = ollamaVisionModel;
    }

    if (adminSettings) {
      // Update existing settings
      adminSettings = await prisma.adminSettings.update({
        where: { id: adminSettings.id },
        data: updateData,
      });
    } else {
      // Create new settings with provided data
      adminSettings = await prisma.adminSettings.create({
        data: {
          globalOpenaiApiKey: encryptApiKey(globalOpenaiApiKey),
          globalClaudeApiKey: encryptApiKey(globalClaudeApiKey),
          allowUserApiKeys: allowUserApiKeys ?? true,
          allowUserFlightApiKeys: true,
          defaultVisionParser: defaultVisionParser || 'auto',
          defaultTextParser: defaultTextParser || 'auto',
          ollamaUrl: ollamaUrl ?? null,
          ollamaModel: ollamaModel ?? null,
          ollamaVisionModel: ollamaVisionModel ?? null,
        },
      });
    }

    res.json({
      message: 'Parser settings updated successfully',
      settings: {
        globalOpenaiApiKey: decryptApiKey(adminSettings.globalOpenaiApiKey) || undefined,
        globalClaudeApiKey: decryptApiKey(adminSettings.globalClaudeApiKey) || undefined,
        allowUserApiKeys: adminSettings.allowUserApiKeys,
        defaultVisionParser: adminSettings.defaultVisionParser,
        defaultTextParser: adminSettings.defaultTextParser,
        ollamaUrl: adminSettings.ollamaUrl || process.env.OLLAMA_URL || null,
        ollamaModel: adminSettings.ollamaModel || process.env.OLLAMA_MODEL || null,
        ollamaVisionModel: adminSettings.ollamaVisionModel || process.env.OLLAMA_VISION_MODEL || null,
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
      // Current effective values (from ENV if not set in admin)
      currentTrainingModelOutputDir: trainingModelOutputDir,
      currentTrainingEmailModelName: trainingEmailModelName,
      currentTrainingVisionModelName: trainingVisionModelName,
      // ENV fallback values
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
          defaultVisionParser: 'auto',
          defaultTextParser: 'auto',
          ...updateData,
        },
      });
    }

    logger.info({
      operation: 'training_config_updated',
      message: 'Training configuration updated',
      context: {
        userId: req.userId,
        settings: updateData,
      },
    });

    // Get updated effective values
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
