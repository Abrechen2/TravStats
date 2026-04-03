import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { decryptApiKey, encryptApiKey } from '../../utils/encryption';
import logger from '../../utils/logger';
import {
  testOpenAIKey,
  testClaudeKey,
  testAirlabsKey,
  testAviationstackKey,
  testOpenSkyCredentials,
} from '../../services/apiKeyTester';

interface GlobalApiKeysUpdateData {
  globalAirlabsApiKey?: string | null;
  globalAviationstackApiKey?: string | null;
  globalOpenskyClientId?: string | null;
  globalOpenskyClientSecret?: string | null;
  globalOpenskyUsername?: string | null;
  globalOpenskyPassword?: string | null;
  allowUserFlightApiKeys?: boolean;
}

const globalApiKeysSchema = z.object({
  globalAirlabsApiKey: z.string().optional().nullable(),
  globalAviationstackApiKey: z.string().optional().nullable(),
  globalOpenskyClientId: z.string().optional().nullable(),
  globalOpenskyClientSecret: z.string().optional().nullable(),
  globalOpenskyUsername: z.string().optional().nullable(),
  globalOpenskyPassword: z.string().optional().nullable(),
  allowUserFlightApiKeys: z.boolean().optional(),
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

const router = Router();

// Get global API keys
router.get('/api-keys', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminSettings = await prisma.adminSettings.findFirst();

    if (!adminSettings) {
      return res.json({
        globalAirlabsApiKey: undefined,
        globalAviationstackApiKey: undefined,
        globalOpenskyClientId: undefined,
        globalOpenskyClientSecret: undefined,
        globalOpenskyUsername: undefined,
        globalOpenskyPassword: undefined,
        allowUserFlightApiKeys: true,
      });
    }

    res.json({
      globalAirlabsApiKey: decryptApiKey(adminSettings.globalAirlabsApiKey) || undefined,
      globalAviationstackApiKey: decryptApiKey(adminSettings.globalAviationstackApiKey) || undefined,
      globalOpenskyClientId: decryptApiKey(adminSettings.globalOpenskyClientId) || undefined,
      globalOpenskyClientSecret: decryptApiKey(adminSettings.globalOpenskyClientSecret) || undefined,
      globalOpenskyUsername: decryptApiKey(adminSettings.globalOpenskyUsername) || undefined,
      globalOpenskyPassword: decryptApiKey(adminSettings.globalOpenskyPassword) || undefined,
      allowUserFlightApiKeys: adminSettings.allowUserFlightApiKeys ?? true,
    });
  } catch (error) {
    logger.error({
      operation: 'get_global_api_keys_error',
      message: 'Failed to get global API keys',
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    next(error);
  }
});

// Update global API keys
router.put('/api-keys', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const payload = globalApiKeysSchema.parse(req.body);

    let adminSettings = await prisma.adminSettings.findFirst();

    const updateData: GlobalApiKeysUpdateData = {};

    // Encrypt flight lookup API keys before storing
    if (payload.globalAirlabsApiKey !== undefined) {
      updateData.globalAirlabsApiKey = encryptApiKey(payload.globalAirlabsApiKey);
    }
    if (payload.globalAviationstackApiKey !== undefined) {
      updateData.globalAviationstackApiKey = encryptApiKey(payload.globalAviationstackApiKey);
    }
    if (payload.globalOpenskyClientId !== undefined) {
      updateData.globalOpenskyClientId = encryptApiKey(payload.globalOpenskyClientId);
    }
    if (payload.globalOpenskyClientSecret !== undefined) {
      updateData.globalOpenskyClientSecret = encryptApiKey(payload.globalOpenskyClientSecret);
    }
    if (payload.globalOpenskyUsername !== undefined) {
      updateData.globalOpenskyUsername = encryptApiKey(payload.globalOpenskyUsername);
    }
    if (payload.globalOpenskyPassword !== undefined) {
      updateData.globalOpenskyPassword = encryptApiKey(payload.globalOpenskyPassword);
    }
    if (payload.allowUserFlightApiKeys !== undefined) {
      updateData.allowUserFlightApiKeys = payload.allowUserFlightApiKeys;
    }

    if (adminSettings) {
      adminSettings = await prisma.adminSettings.update({
        where: { id: adminSettings.id },
        data: updateData,
      });
    } else {
      adminSettings = await prisma.adminSettings.create({
        data: {
          allowUserApiKeys: true,
          defaultVisionParser: 'auto',
          defaultTextParser: 'auto',
          allowUserFlightApiKeys: true,
          ...updateData,
        },
      });
    }

    res.json({
      message: 'Global API keys updated successfully',
      settings: {
        globalAirlabsApiKey: decryptApiKey(adminSettings.globalAirlabsApiKey) || undefined,
        globalAviationstackApiKey: decryptApiKey(adminSettings.globalAviationstackApiKey) || undefined,
        globalOpenskyClientId: decryptApiKey(adminSettings.globalOpenskyClientId) || undefined,
        globalOpenskyClientSecret: decryptApiKey(adminSettings.globalOpenskyClientSecret) || undefined,
        globalOpenskyUsername: decryptApiKey(adminSettings.globalOpenskyUsername) || undefined,
        globalOpenskyPassword: decryptApiKey(adminSettings.globalOpenskyPassword) || undefined,
        allowUserFlightApiKeys: adminSettings.allowUserFlightApiKeys,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Test API key endpoints (admin)
router.post('/api-keys/test/openai', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const result = await testOpenAIKey(apiKey);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api-keys/test/claude', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const result = await testClaudeKey(apiKey);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api-keys/test/airlabs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const result = await testAirlabsKey(apiKey);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api-keys/test/aviationstack', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const result = await testAviationstackKey(apiKey);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api-keys/test/opensky', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { clientId, clientSecret, username, password } = testOpenSkySchema.parse(req.body);
    const result = await testOpenSkyCredentials({ clientId, clientSecret, username, password });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
