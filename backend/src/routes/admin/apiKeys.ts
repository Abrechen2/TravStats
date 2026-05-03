import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { decryptApiKey, encryptApiKey } from '../../utils/encryption';
import logger from '../../utils/logger';
import {
  testAirlabsKey,
  testAviationstackKey,
  testAerodataboxKey,
  testOpenSkyCredentials,
} from '../../services/apiKeyTester';

interface GlobalApiKeysUpdateData {
  globalAirlabsApiKey?: string | null;
  globalAviationstackApiKey?: string | null;
  globalAerodataboxApiKey?: string | null;
  globalOpenskyClientId?: string | null;
  globalOpenskyClientSecret?: string | null;
  globalOpenskyUsername?: string | null;
  globalOpenskyPassword?: string | null;
  allowUserFlightApiKeys?: boolean;
}

const globalApiKeysSchema = z.object({
  globalAirlabsApiKey: z.string().optional().nullable(),
  globalAviationstackApiKey: z.string().optional().nullable(),
  globalAerodataboxApiKey: z.string().optional().nullable(),
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

/** Mask a decrypted key for safe display: "abcd****wxyz" */
const maskKey = (encrypted: string | null | undefined): string | undefined => {
  const decrypted = decryptApiKey(encrypted);
  if (!decrypted) return undefined;
  if (decrypted.length <= 8) return "****";
  return decrypted.slice(0, 4) + "****" + decrypted.slice(-4);
};

// Get global API keys
router.get('/api-keys', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminSettings = await prisma.adminSettings.findFirst();

    if (!adminSettings) {
      return res.json({
        globalAirlabsApiKey: undefined,
        globalAviationstackApiKey: undefined,
        globalAerodataboxApiKey: undefined,
        globalOpenskyClientId: undefined,
        globalOpenskyClientSecret: undefined,
        globalOpenskyUsername: undefined,
        globalOpenskyPassword: undefined,
        allowUserFlightApiKeys: true,
      });
    }

    res.json({
      globalAirlabsApiKey: maskKey(adminSettings.globalAirlabsApiKey),
      globalAviationstackApiKey: maskKey(adminSettings.globalAviationstackApiKey),
      globalAerodataboxApiKey: maskKey(adminSettings.globalAerodataboxApiKey),
      globalOpenskyClientId: maskKey(adminSettings.globalOpenskyClientId),
      globalOpenskyClientSecret: maskKey(adminSettings.globalOpenskyClientSecret),
      globalOpenskyUsername: maskKey(adminSettings.globalOpenskyUsername),
      globalOpenskyPassword: maskKey(adminSettings.globalOpenskyPassword),
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
    if (payload.globalAerodataboxApiKey !== undefined) {
      updateData.globalAerodataboxApiKey = encryptApiKey(payload.globalAerodataboxApiKey);
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
        globalAirlabsApiKey: maskKey(adminSettings.globalAirlabsApiKey),
        globalAviationstackApiKey: maskKey(adminSettings.globalAviationstackApiKey),
        globalAerodataboxApiKey: maskKey(adminSettings.globalAerodataboxApiKey),
        globalOpenskyClientId: maskKey(adminSettings.globalOpenskyClientId),
        globalOpenskyClientSecret: maskKey(adminSettings.globalOpenskyClientSecret),
        globalOpenskyUsername: maskKey(adminSettings.globalOpenskyUsername),
        globalOpenskyPassword: maskKey(adminSettings.globalOpenskyPassword),
        allowUserFlightApiKeys: adminSettings.allowUserFlightApiKeys,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Test API key endpoints (admin)
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

router.post('/api-keys/test/aerodatabox', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const result = await testAerodataboxKey(apiKey);
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
