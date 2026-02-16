import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { encryptApiKey, decryptApiKey } from '../../utils/encryption';
import { ParserSettingsUpdateData, defaultSettings } from './types';

const router = Router();

const parserSettingsSchema = z.object({
  preferredVisionParser: z.string().optional(),
  preferredTextParser: z.string().optional(),
  visionFallbackChain: z.string().optional(),
  textFallbackChain: z.string().optional(),
  openaiApiKey: z.string().optional().nullable(),
  claudeApiKey: z.string().optional().nullable(),
}).partial();

// GET /
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    let settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        preferredVisionParser: true,
        preferredTextParser: true,
        visionFallbackChain: true,
        textFallbackChain: true,
        openaiApiKey: true,
        claudeApiKey: true,
      },
    });

    if (!settings) {
      // Create default parser settings if they don't exist
      const created = await prisma.userSettings.create({
        data: {
          userId,
          data: defaultSettings,
          preferredVisionParser: 'auto',
          preferredTextParser: 'auto',
          visionFallbackChain: 'ollama,openai,claude,tesseract,manual',
          textFallbackChain: 'ollama,openai,claude,regex',
        },
      });

      settings = {
        preferredVisionParser: created.preferredVisionParser,
        preferredTextParser: created.preferredTextParser,
        visionFallbackChain: created.visionFallbackChain,
        textFallbackChain: created.textFallbackChain,
        openaiApiKey: created.openaiApiKey,
        claudeApiKey: created.claudeApiKey,
      };
    }

    // Decrypt API keys before returning
    res.json({
      ...settings,
      openaiApiKey: decryptApiKey(settings.openaiApiKey),
      claudeApiKey: decryptApiKey(settings.claudeApiKey),
    });
  } catch (error) {
    next(error);
  }
});

// PUT /
router.put('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const payload = parserSettingsSchema.parse(req.body);

    const updateData: ParserSettingsUpdateData = {};

    // Only update fields that are provided
    if (payload.preferredVisionParser !== undefined) {
      updateData.preferredVisionParser = payload.preferredVisionParser;
    }
    if (payload.preferredTextParser !== undefined) {
      updateData.preferredTextParser = payload.preferredTextParser;
    }
    if (payload.visionFallbackChain !== undefined) {
      updateData.visionFallbackChain = payload.visionFallbackChain;
    }
    if (payload.textFallbackChain !== undefined) {
      updateData.textFallbackChain = payload.textFallbackChain;
    }
    // Encrypt API keys before storing
    if (payload.openaiApiKey !== undefined) {
      updateData.openaiApiKey = encryptApiKey(payload.openaiApiKey);
    }
    if (payload.claudeApiKey !== undefined) {
      updateData.claudeApiKey = encryptApiKey(payload.claudeApiKey);
    }

    // Get admin settings to check permissions
    const adminSettings = await prisma.adminSettings.findFirst();
    const allowUserApiKeys = adminSettings?.allowUserApiKeys ?? true;

    // If user API keys are not allowed, prevent users from setting them
    if (!allowUserApiKeys) {
      if (updateData.openaiApiKey !== undefined || updateData.claudeApiKey !== undefined) {
        res.status(403).json({
          error: 'User API keys are not allowed by administrator',
        });
        return;
      }
    }

    const updated = await prisma.userSettings.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        data: defaultSettings,
        preferredVisionParser: updateData.preferredVisionParser || 'auto',
        preferredTextParser: updateData.preferredTextParser || 'auto',
        visionFallbackChain: updateData.visionFallbackChain || 'ollama,openai,claude,tesseract,manual',
        textFallbackChain: updateData.textFallbackChain || 'ollama,openai,claude,regex',
        openaiApiKey: encryptApiKey(updateData.openaiApiKey),
        claudeApiKey: encryptApiKey(updateData.claudeApiKey),
      },
      select: {
        preferredVisionParser: true,
        preferredTextParser: true,
        visionFallbackChain: true,
        textFallbackChain: true,
        openaiApiKey: true,
        claudeApiKey: true,
      },
    });

    // Decrypt API keys before returning
    res.json({
      message: 'Parser settings updated successfully',
      settings: {
        ...updated,
        openaiApiKey: decryptApiKey(updated.openaiApiKey),
        claudeApiKey: decryptApiKey(updated.claudeApiKey),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
