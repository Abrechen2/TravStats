import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { encryptApiKey } from '../../utils/encryption';
import { hasApiKeyAccess } from '../../services/apiKeyResolver';
import {
  testOpenAIKey,
  testClaudeKey,
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
  openaiApiKey: z.string().optional().nullable(),
  claudeApiKey: z.string().optional().nullable(),
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

    // Try to get user settings - handle case where fields might not exist
    let settings: UserApiKeySettings | null = null;
    try {
      settings = await prisma.userSettings.findUnique({
        where: { userId },
        select: {
          openaiApiKey: true,
          claudeApiKey: true,
          airlabsApiKey: true,
          aviationstackApiKey: true,
          openskyClientId: true,
          openskyClientSecret: true,
          openskyUsername: true,
          openskyPassword: true,
        },
      });
    } catch (error: unknown) {
      // If fields don't exist, settings will be null
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

    // Get admin settings to check for shared keys
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

    // Check access status for each provider - handle errors gracefully
    let openaiAccess = { hasAccess: false, isShared: false };
    let claudeAccess = { hasAccess: false, isShared: false };
    let airlabsAccess = { hasAccess: false, isShared: false };
    let aviationstackAccess = { hasAccess: false, isShared: false };

    try {
      [openaiAccess, claudeAccess, airlabsAccess, aviationstackAccess] = await Promise.all([
        hasApiKeyAccess('openai', userId),
        hasApiKeyAccess('claude', userId),
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

    // Check OpenSky (has multiple credentials)
    const hasUserOpensky = settings && (settings.openskyClientId || settings.openskyUsername);
    const hasGlobalOpensky = adminSettings && (
      adminSettings.globalOpenskyClientId ||
      adminSettings.globalOpenskyUsername
    );
    const openskyShared = hasGlobalOpensky && !hasUserOpensky;

    res.json({
      openai: {
        hasKey: !!settings?.openaiApiKey,
        isShared: openaiAccess.isShared,
        hasAccess: openaiAccess.hasAccess,
      },
      claude: {
        hasKey: !!settings?.claudeApiKey,
        isShared: claudeAccess.isShared,
        hasAccess: claudeAccess.hasAccess,
      },
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

    // Get admin settings to check permissions
    const adminSettings = await prisma.adminSettings.findFirst();
    const allowUserApiKeys = adminSettings?.allowUserApiKeys ?? true;
    const allowUserFlightApiKeys = adminSettings?.allowUserFlightApiKeys ?? true;

    const updateData: ApiKeysUpdateData = {};

    // Encrypt parser API keys before storing
    if (payload.openaiApiKey !== undefined) {
      if (!allowUserApiKeys) {
        res.status(403).json({
          error: 'User API keys are not allowed by administrator',
        });
        return;
      }
      updateData.openaiApiKey = encryptApiKey(payload.openaiApiKey);
    }
    if (payload.claudeApiKey !== undefined) {
      if (!allowUserApiKeys) {
        res.status(403).json({
          error: 'User API keys are not allowed by administrator',
        });
        return;
      }
      updateData.claudeApiKey = encryptApiKey(payload.claudeApiKey);
    }

    // Encrypt flight lookup API keys before storing
    if (payload.airlabsApiKey !== undefined) {
      if (!allowUserFlightApiKeys) {
        res.status(403).json({
          error: 'User flight API keys are not allowed by administrator',
        });
        return;
      }
      updateData.airlabsApiKey = encryptApiKey(payload.airlabsApiKey);
    }
    if (payload.aviationstackApiKey !== undefined) {
      if (!allowUserFlightApiKeys) {
        res.status(403).json({
          error: 'User flight API keys are not allowed by administrator',
        });
        return;
      }
      updateData.aviationstackApiKey = encryptApiKey(payload.aviationstackApiKey);
    }
    if (payload.openskyClientId !== undefined) {
      if (!allowUserFlightApiKeys) {
        res.status(403).json({
          error: 'User flight API keys are not allowed by administrator',
        });
        return;
      }
      updateData.openskyClientId = encryptApiKey(payload.openskyClientId);
    }
    if (payload.openskyClientSecret !== undefined) {
      if (!allowUserFlightApiKeys) {
        res.status(403).json({
          error: 'User flight API keys are not allowed by administrator',
        });
        return;
      }
      updateData.openskyClientSecret = encryptApiKey(payload.openskyClientSecret);
    }
    // Clear username/password if they are sent as null/empty (OpenSky now only uses OAuth2)
    if (payload.openskyUsername !== undefined) {
      updateData.openskyUsername = null;
    }
    if (payload.openskyPassword !== undefined) {
      updateData.openskyPassword = null;
    }

    // Update settings
    await prisma.userSettings.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        data: defaultSettings,
        ...updateData,
      },
    });

    // Return updated status
    const [openaiAccess, claudeAccess, airlabsAccess, aviationstackAccess] = await Promise.all([
      hasApiKeyAccess('openai', userId),
      hasApiKeyAccess('claude', userId),
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
        openai: {
          hasKey: !!updateData.openaiApiKey || openaiAccess.hasAccess,
          isShared: openaiAccess.isShared,
        },
        claude: {
          hasKey: !!updateData.claudeApiKey || claudeAccess.hasAccess,
          isShared: claudeAccess.isShared,
        },
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

// POST /test/openai
router.post('/test/openai', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const result = await testOpenAIKey(apiKey, req.userId!);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /test/claude
router.post('/test/claude', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const result = await testClaudeKey(apiKey, req.userId!);
    res.json(result);
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
