import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { encryptApiKey } from '../../utils/encryption';
import {
  testAirlabsKey,
  testAviationstackKey,
  testOpenSkyCredentials,
} from '../../services/apiKeyTester';
import logger from '../../utils/logger';
import {
  ApiKeysUpdateData,
  UserApiKeySettings,
  PrismaErrorWithCode,
  defaultSettings,
} from './types';

const router = Router();

const apiKeysSchema = z.object({
  airlabsApiKey: z.string().optional().nullable(),
  aviationstackApiKey: z.string().optional().nullable(),
  openskyClientId: z.string().optional().nullable(),
  openskyClientSecret: z.string().optional().nullable(),
  openskyUsername: z.string().optional().nullable(),
  openskyPassword: z.string().optional().nullable(),
}).partial();

const testApiKeySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
});

const testOpenSkySchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
}).refine(
  (data) => (!!data.clientId && !!data.clientSecret) || (!!data.username && !!data.password),
  { message: 'Provide either clientId+clientSecret or username+password' }
);

// GET /
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    let settings: Pick<UserApiKeySettings, 'airlabsApiKey' | 'aviationstackApiKey' | 'openskyClientId' | 'openskyClientSecret' | 'openskyUsername' | 'openskyPassword'> | null = null;
    try {
      settings = await prisma.userSettings.findUnique({
        where: { userId },
        select: {
          airlabsApiKey: true,
          aviationstackApiKey: true,
          openskyClientId: true,
          openskyClientSecret: true,
          openskyUsername: true,
          openskyPassword: true,
        },
      });
    } catch (error: unknown) {
      const prismaError = error as PrismaErrorWithCode;
      if (prismaError.code !== 'P2009' && prismaError.code !== 'P2025') {
        throw error;
      }
      logger.warn({
        operation: 'get_api_keys_user_settings_error',
        message: 'Failed to get user settings, fields might not exist',
        error: prismaError.message,
      });
    }

    let adminSettings: Awaited<ReturnType<typeof prisma.adminSettings.findFirst>> = null;
    try {
      adminSettings = await prisma.adminSettings.findFirst();
    } catch (error: unknown) {
      logger.warn({
        operation: 'get_api_keys_admin_settings_error',
        message: 'Failed to get admin settings',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    let airlabsAccess = { hasAccess: false, isShared: false };
    let aviationstackAccess = { hasAccess: false, isShared: false };

    try {
      const { hasApiKeyAccess } = await import('../../services/apiKeyResolver');
      [airlabsAccess, aviationstackAccess] = await Promise.all([
        hasApiKeyAccess('airlabs', userId),
        hasApiKeyAccess('aviationstack', userId),
      ]);
    } catch (error: unknown) {
      logger.warn({
        operation: 'get_api_keys_access_check_error',
        message: 'Failed to check API key access',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    const hasUserOpensky = settings && (settings.openskyClientId || settings.openskyUsername);
    const hasGlobalOpensky = adminSettings && (
      adminSettings.globalOpenskyClientId ||
      adminSettings.globalOpenskyUsername
    );
    const openskyShared = hasGlobalOpensky && !hasUserOpensky;

    res.json({
      airlabs: {
        hasKey: !!settings?.airlabsApiKey,
        isShared: airlabsAccess.isShared,
        hasAccess: airlabsAccess.hasAccess,
      },
      aviationstack: {
        hasKey: !!settings?.aviationstackApiKey,
        isShared: aviationstackAccess.isShared,
        hasAccess: aviationstackAccess.hasAccess,
      },
      opensky: {
        hasKey: !!hasUserOpensky,
        isShared: openskyShared,
        hasAccess: hasUserOpensky || hasGlobalOpensky || !!(process.env.OPENSKY_CLIENT_ID || process.env.OPENSKY_USERNAME),
      },
    });
  } catch (error) {
    logger.error({
      operation: 'get_api_keys_error',
      message: 'Failed to get API keys status',
      context: {
        userId: req.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    next(error);
  }
});

// PUT /
router.put('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const payload = apiKeysSchema.parse(req.body);

    const adminSettings = await prisma.adminSettings.findFirst();
    const allowUserFlightApiKeys = adminSettings?.allowUserFlightApiKeys ?? true;

    const updateData: ApiKeysUpdateData = {};

    if (payload.airlabsApiKey !== undefined) {
      if (!allowUserFlightApiKeys) {
        res.status(403).json({ error: 'User flight API keys are not allowed by administrator' });
        return;
      }
      updateData.airlabsApiKey = encryptApiKey(payload.airlabsApiKey);
    }
    if (payload.aviationstackApiKey !== undefined) {
      if (!allowUserFlightApiKeys) {
        res.status(403).json({ error: 'User flight API keys are not allowed by administrator' });
        return;
      }
      updateData.aviationstackApiKey = encryptApiKey(payload.aviationstackApiKey);
    }
    if (payload.openskyClientId !== undefined) {
      if (!allowUserFlightApiKeys) {
        res.status(403).json({ error: 'User flight API keys are not allowed by administrator' });
        return;
      }
      updateData.openskyClientId = encryptApiKey(payload.openskyClientId);
    }
    if (payload.openskyClientSecret !== undefined) {
      if (!allowUserFlightApiKeys) {
        res.status(403).json({ error: 'User flight API keys are not allowed by administrator' });
        return;
      }
      updateData.openskyClientSecret = encryptApiKey(payload.openskyClientSecret);
    }
    if (payload.openskyUsername !== undefined) {
      updateData.openskyUsername = null;
    }
    if (payload.openskyPassword !== undefined) {
      updateData.openskyPassword = null;
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

    const { hasApiKeyAccess } = await import('../../services/apiKeyResolver');
    const [airlabsAccess, aviationstackAccess] = await Promise.all([
      hasApiKeyAccess('airlabs', userId),
      hasApiKeyAccess('aviationstack', userId),
    ]);

    const updatedSettings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        openskyClientId: true,
        openskyUsername: true,
      },
    });

    const adminSettingsAfter = await prisma.adminSettings.findFirst();
    const hasGlobalOpensky = adminSettingsAfter && adminSettingsAfter.globalOpenskyClientId;

    res.json({
      message: 'API keys updated successfully',
      apiKeys: {
        airlabs: {
          hasKey: !!updateData.airlabsApiKey || airlabsAccess.hasAccess,
          isShared: airlabsAccess.isShared,
        },
        aviationstack: {
          hasKey: !!updateData.aviationstackApiKey || aviationstackAccess.hasAccess,
          isShared: aviationstackAccess.isShared,
        },
        opensky: {
          hasKey: !!updatedSettings?.openskyClientId,
          isShared: hasGlobalOpensky && !updatedSettings?.openskyClientId,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /test/airlabs
router.post('/test/airlabs', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const result = await testAirlabsKey(apiKey, req.userId!);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /test/aviationstack
router.post('/test/aviationstack', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const result = await testAviationstackKey(apiKey, req.userId!);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /test/opensky
router.post('/test/opensky', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { clientId, clientSecret, username, password } = testOpenSkySchema.parse(req.body);
    const result = await testOpenSkyCredentials(
      { clientId, clientSecret, username, password },
      req.userId!
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
