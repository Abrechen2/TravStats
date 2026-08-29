import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { encryptApiKey } from '../../utils/encryption';
import {
  testAirlabsKey,
  testAviationstackKey,
  testAerodataboxKey,
  testOpenSkyCredentials,
  testOpenRouteServiceKey,
  testGraphHopperKey,
} from '../../services/apiKeyTester';
import { getApiKey, getOpenSkyCredentials } from '../../services/apiKeyResolver';
import { getAllProviderQuotas } from '../../services/apiQuota';
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
  aerodataboxApiKey: z.string().optional().nullable(),
  openskyClientId: z.string().optional().nullable(),
  openskyClientSecret: z.string().optional().nullable(),
  openskyUsername: z.string().optional().nullable(),
  openskyPassword: z.string().optional().nullable(),
  // Tour routing provider keys (Phase 3) — not gated by allowUserFlightApiKeys,
  // which is specifically about flight-lookup providers.
  openrouteserviceApiKey: z.string().optional().nullable(),
  graphhopperApiKey: z.string().optional().nullable(),
}).partial();

const testApiKeySchema = z.object({
  apiKey: z.string().optional(),
});

const testOpenSkySchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});

/**
 * Frontend ships the masked GET-response value (e.g. "ac97****2a86") back
 * into the Test request when the user hasn't typed anything new. Treat
 * empty + masked as "test the persisted/inherited key".
 */
const looksMasked = (s: string | undefined | null): boolean =>
  !s || s.includes('****');

// GET /
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;

    let settings: Pick<UserApiKeySettings, 'airlabsApiKey' | 'aviationstackApiKey' | 'aerodataboxApiKey' | 'openskyClientId' | 'openskyClientSecret' | 'openskyUsername' | 'openskyPassword' | 'openrouteserviceApiKey' | 'graphhopperApiKey'> | null = null;
    try {
      settings = await prisma.userSettings.findUnique({
        where: { userId },
        select: {
          airlabsApiKey: true,
          aviationstackApiKey: true,
          aerodataboxApiKey: true,
          openskyClientId: true,
          openskyClientSecret: true,
          openskyUsername: true,
          openskyPassword: true,
          openrouteserviceApiKey: true,
          graphhopperApiKey: true,
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
    let aerodataboxAccess = { hasAccess: false, isShared: false };
    let openrouteserviceAccess = { hasAccess: false, isShared: false };
    let graphhopperAccess = { hasAccess: false, isShared: false };

    try {
      const { hasApiKeyAccess } = await import('../../services/apiKeyResolver');
      [airlabsAccess, aviationstackAccess, aerodataboxAccess, openrouteserviceAccess, graphhopperAccess] = await Promise.all([
        hasApiKeyAccess('airlabs', userId),
        hasApiKeyAccess('aviationstack', userId),
        hasApiKeyAccess('aerodatabox', userId),
        hasApiKeyAccess('openrouteservice', userId),
        hasApiKeyAccess('graphhopper', userId),
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
      aerodatabox: {
        hasKey: !!settings?.aerodataboxApiKey,
        isShared: aerodataboxAccess.isShared,
        hasAccess: aerodataboxAccess.hasAccess,
      },
      openrouteservice: {
        hasKey: !!settings?.openrouteserviceApiKey,
        isShared: openrouteserviceAccess.isShared,
        hasAccess: openrouteserviceAccess.hasAccess,
      },
      graphhopper: {
        hasKey: !!settings?.graphhopperApiKey,
        isShared: graphhopperAccess.isShared,
        hasAccess: graphhopperAccess.hasAccess,
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
    if (payload.aerodataboxApiKey !== undefined) {
      if (!allowUserFlightApiKeys) {
        res.status(403).json({ error: 'User flight API keys are not allowed by administrator' });
        return;
      }
      updateData.aerodataboxApiKey = encryptApiKey(payload.aerodataboxApiKey);
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
    if (payload.openskyUsername !== undefined || payload.openskyPassword !== undefined) {
      res.status(400).json({
        error: 'OpenSky username/password authentication is no longer supported, use client credentials instead',
      });
      return;
    }
    if (payload.openrouteserviceApiKey !== undefined) {
      updateData.openrouteserviceApiKey = encryptApiKey(payload.openrouteserviceApiKey);
    }
    if (payload.graphhopperApiKey !== undefined) {
      updateData.graphhopperApiKey = encryptApiKey(payload.graphhopperApiKey);
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
    const [airlabsAccess, aviationstackAccess, aerodataboxAccess, openrouteserviceAccess, graphhopperAccess] = await Promise.all([
      hasApiKeyAccess('airlabs', userId),
      hasApiKeyAccess('aviationstack', userId),
      hasApiKeyAccess('aerodatabox', userId),
      hasApiKeyAccess('openrouteservice', userId),
      hasApiKeyAccess('graphhopper', userId),
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
        aerodatabox: {
          hasKey: !!updateData.aerodataboxApiKey || aerodataboxAccess.hasAccess,
          isShared: aerodataboxAccess.isShared,
        },
        openrouteservice: {
          hasKey: !!updateData.openrouteserviceApiKey || openrouteserviceAccess.hasAccess,
          isShared: openrouteserviceAccess.isShared,
        },
        graphhopper: {
          hasKey: !!updateData.graphhopperApiKey || graphhopperAccess.hasAccess,
          isShared: graphhopperAccess.isShared,
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
    const effective = looksMasked(apiKey)
      ? (await getApiKey('airlabs', req.userId!)) ?? ''
      : apiKey!;
    if (!effective) {
      res.status(400).json({ success: false, message: 'No AirLabs key configured to test. Save one first.' });
      return;
    }
    const result = await testAirlabsKey(effective, req.userId!);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /test/aviationstack
router.post('/test/aviationstack', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const effective = looksMasked(apiKey)
      ? (await getApiKey('aviationstack', req.userId!)) ?? ''
      : apiKey!;
    if (!effective) {
      res.status(400).json({ success: false, message: 'No Aviationstack key configured to test. Save one first.' });
      return;
    }
    const result = await testAviationstackKey(effective, req.userId!);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /test/aerodatabox
router.post('/test/aerodatabox', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const effective = looksMasked(apiKey)
      ? (await getApiKey('aerodatabox', req.userId!)) ?? ''
      : apiKey!;
    if (!effective) {
      res.status(400).json({ success: false, message: 'No AeroDataBox key configured to test. Save one first.' });
      return;
    }
    const result = await testAerodataboxKey(effective, req.userId!);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /test/openrouteservice
router.post('/test/openrouteservice', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const effective = looksMasked(apiKey)
      ? (await getApiKey('openrouteservice', req.userId!)) ?? ''
      : apiKey!;
    if (!effective) {
      res.status(400).json({ success: false, message: 'No OpenRouteService key configured to test. Save one first.' });
      return;
    }
    const result = await testOpenRouteServiceKey(effective, req.userId!);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /test/graphhopper
router.post('/test/graphhopper', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const effective = looksMasked(apiKey)
      ? (await getApiKey('graphhopper', req.userId!)) ?? ''
      : apiKey!;
    if (!effective) {
      res.status(400).json({ success: false, message: 'No GraphHopper key configured to test. Save one first.' });
      return;
    }
    const result = await testGraphHopperKey(effective, req.userId!);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /test/opensky
router.post('/test/opensky', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    let { clientId, clientSecret, username, password } = testOpenSkySchema.parse(req.body);
    if (looksMasked(clientId) || looksMasked(clientSecret)) {
      const persisted = await getOpenSkyCredentials(req.userId!);
      clientId = persisted?.clientId ?? undefined;
      clientSecret = persisted?.clientSecret ?? undefined;
      username = username || persisted?.username || undefined;
      password = password || persisted?.password || undefined;
    }
    if (!(clientId && clientSecret) && !(username && password)) {
      res.status(400).json({ success: false, message: 'No OpenSky credentials configured to test. Save them first.' });
      return;
    }
    const result = await testOpenSkyCredentials(
      { clientId, clientSecret, username, password },
      req.userId!
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// GET /quota — per-provider quota observation. Different providers
// expose quota differently:
//   - aerodatabox  → live `kind: 'observed'` from RapidAPI headers
//   - airlabs      → `kind: 'not_reported'` (no headers in free tier)
//   - aviationstack → `kind: 'not_reported'`
//   - opensky      → `kind: 'rate_limit_only'` (per-second IP, no monthly)
// The frontend uses this to show honest, per-card quota indicators
// rather than a single misleading global counter.
router.get('/quota', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    res.json(getAllProviderQuotas(userId));
  } catch (error) {
    next(error);
  }
});

export default router;
