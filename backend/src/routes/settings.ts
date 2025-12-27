import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireTrainingAccess } from '../middleware/trainingAuth';
import { prisma } from '../db';
import { encryptApiKey, decryptApiKey } from '../utils/encryption';
import { hasApiKeyAccess } from '../services/apiKeyResolver';
import {
  testOpenAIKey,
  testClaudeKey,
  testAirlabsKey,
  testAviationstackKey,
  testOpenSkyCredentials,
} from '../services/apiKeyTester';
import logger from '../utils/logger';

const router = Router();

// All routes require authentication
router.use(authenticate);

const settingsSchema = z.object({
  profile: z.object({
    username: z.string().optional(),
    email: z.string().email().optional(),
    profilePicture: z.string().url().optional().nullable(),
  }).partial().optional(),
  display: z.object({
    theme: z.enum(['light', 'dark']).optional(),
    language: z.enum(['de', 'en']).optional(),
    timezone: z.string().optional(),
    dateFormat: z.enum(['DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),
    timeFormat: z.enum(['24h', '12h']).optional(),
  }).partial().optional(),
  units: z.object({
    distanceUnit: z.enum(['kilometers', 'miles', 'nautical_miles']).optional(),
    currency: z.enum(['EUR', 'USD', 'GBP', 'CHF']).optional(),
  }).partial().optional(),
  defaults: z.object({
    flightStatus: z.enum(['scheduled', 'flown']).optional(),
    seatClass: z.enum(['economy', 'premium_economy', 'business', 'first']).optional(),
    favoriteAirline: z.string().optional(),
    flightCategory: z.enum(['business', 'private', 'vacation']).optional(),
  }).partial().optional(),
  map: z.object({
    mapStyle: z.enum(['osm', 'satellite']).optional(),
    zoomLevel: z.number().min(1).max(18).optional(),
    markerStyle: z.enum(['pin', 'circle', 'custom']).optional(),
    routeColor: z.string().optional(),
  }).partial().optional(),
  notifications: z.object({
    emailNotifications: z.boolean().optional(),
    flightReminder: z.enum(['off', '24h', '48h']).optional(),
    checkInReminder: z.boolean().optional(),
    featureUpdates: z.boolean().optional(),
  }).partial().optional(),
  privacy: z.object({
    twoFactorAuth: z.boolean().optional(),
    loginAlerts: z.boolean().optional(),
    dataExportRequested: z.boolean().optional(),
    accountDeletionRequested: z.boolean().optional(),
    analyticsOptIn: z.boolean().optional(),
  }).partial().optional(),
  backup: z.object({
    autoBackup: z.boolean().optional(),
    backupInterval: z.enum(['daily', 'weekly', 'monthly']).optional(),
    exportFormat: z.enum(['json', 'csv', 'pdf']).optional(),
    cloudSync: z.boolean().optional(),
  }).partial().optional(),
  autoUpdate: z.object({
    enabled: z.boolean().optional(),
    requireApproval: z.boolean().optional(),
    checkInterval: z.number().min(5).max(1440).optional(), // 5 minutes to 24 hours
    onlyDuringFlight: z.boolean().optional(),
    expiryHours: z.number().min(1).max(168).optional(), // 1 hour to 1 week
  }).partial().optional(),
}).partial();

const defaultSettings = {
  profile: { username: 'Traveler', email: 'traveler@example.com', profilePicture: null },
  display: { theme: 'light', language: 'de', timezone: 'Europe/Berlin', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  units: { distanceUnit: 'kilometers', currency: 'EUR' },
  defaults: { flightStatus: 'scheduled', seatClass: 'economy', favoriteAirline: 'Lufthansa', flightCategory: 'business' },
  map: { mapStyle: 'osm', zoomLevel: 3, markerStyle: 'pin', routeColor: '#2563eb' },
  notifications: { emailNotifications: true, flightReminder: '24h', checkInReminder: true, featureUpdates: true },
  privacy: { twoFactorAuth: false, loginAlerts: true, dataExportRequested: false, accountDeletionRequested: false, analyticsOptIn: false },
  backup: { autoBackup: false, backupInterval: 'weekly', exportFormat: 'json', cloudSync: false },
};

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const existing = await prisma.userSettings.findUnique({
      where: { userId },
    });

    if (!existing) {
      const created = await prisma.userSettings.create({
        data: { 
          userId, 
          data: defaultSettings,
          // Initialize training settings with defaults
          useTrainedModels: true,
          preferredEmailModel: 'auto',
          preferredVisionModel: 'auto',
          trainingSeparateModels: true,
          // Initialize auto-update settings with defaults
          autoUpdateEnabled: false,
          autoUpdateRequireApproval: true,
          autoUpdateCheckInterval: 15,
          autoUpdateOnlyDuringFlight: true,
          autoUpdateExpiryHours: 24,
        },
      });
      const response = created.data as any;
      // Add auto-update settings to response
      response.autoUpdate = {
        enabled: created.autoUpdateEnabled,
        requireApproval: created.autoUpdateRequireApproval,
        checkInterval: created.autoUpdateCheckInterval,
        onlyDuringFlight: created.autoUpdateOnlyDuringFlight,
        expiryHours: created.autoUpdateExpiryHours,
      };
      return res.json(response);
    }

    const response = existing.data as any;
    // Add auto-update settings to response
    response.autoUpdate = {
      enabled: existing.autoUpdateEnabled,
      requireApproval: existing.autoUpdateRequireApproval,
      checkInterval: existing.autoUpdateCheckInterval,
      onlyDuringFlight: existing.autoUpdateOnlyDuringFlight,
      expiryHours: existing.autoUpdateExpiryHours,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.put('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const payload = settingsSchema.parse(req.body);

    const existing = await prisma.userSettings.findUnique({
      where: { userId },
    });

    const merged = {
      ...defaultSettings,
      ...(typeof existing?.data === 'object' && existing.data !== null ? existing.data : {}),
      ...payload,
    };

    const updateData: any = {
      data: merged as any,
    };

    // Handle auto-update settings
    if (payload.autoUpdate) {
      if (payload.autoUpdate.enabled !== undefined) {
        updateData.autoUpdateEnabled = payload.autoUpdate.enabled;
      }
      if (payload.autoUpdate.requireApproval !== undefined) {
        updateData.autoUpdateRequireApproval = payload.autoUpdate.requireApproval;
      }
      if (payload.autoUpdate.checkInterval !== undefined) {
        updateData.autoUpdateCheckInterval = payload.autoUpdate.checkInterval;
      }
      if (payload.autoUpdate.onlyDuringFlight !== undefined) {
        updateData.autoUpdateOnlyDuringFlight = payload.autoUpdate.onlyDuringFlight;
      }
      if (payload.autoUpdate.expiryHours !== undefined) {
        updateData.autoUpdateExpiryHours = payload.autoUpdate.expiryHours;
      }
    }

    const saved = await prisma.userSettings.upsert({
      where: { userId },
      update: updateData,
      create: { 
        userId, 
        data: merged as any,
        // Initialize training settings with defaults
        useTrainedModels: true,
        preferredEmailModel: 'auto',
        preferredVisionModel: 'auto',
        trainingSeparateModels: true,
        // Initialize auto-update settings with defaults
        autoUpdateEnabled: payload.autoUpdate?.enabled ?? false,
        autoUpdateRequireApproval: payload.autoUpdate?.requireApproval ?? true,
        autoUpdateCheckInterval: payload.autoUpdate?.checkInterval ?? 15,
        autoUpdateOnlyDuringFlight: payload.autoUpdate?.onlyDuringFlight ?? true,
        autoUpdateExpiryHours: payload.autoUpdate?.expiryHours ?? 24,
      },
    });

    res.json(saved.data);
  } catch (error) {
    next(error);
  }
});

// Parser settings schema
const parserSettingsSchema = z.object({
  preferredVisionParser: z.string().optional(),
  preferredTextParser: z.string().optional(),
  visionFallbackChain: z.string().optional(),
  textFallbackChain: z.string().optional(),
  openaiApiKey: z.string().optional().nullable(),
  claudeApiKey: z.string().optional().nullable(),
}).partial();

// Get parser settings
router.get('/parser', async (req: AuthRequest, res: Response, next: NextFunction) => {
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

// Update parser settings
router.put('/parser', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const payload = parserSettingsSchema.parse(req.body);

    const updateData: any = {};

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
        return res.status(403).json({
          error: 'User API keys are not allowed by administrator',
        });
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

// Training settings schema
const trainingSettingsSchema = z.object({
  useTrainedModels: z.boolean().optional(),
  preferredEmailModel: z.enum(['auto', 'trained', 'base']).optional(),
  preferredVisionModel: z.enum(['auto', 'trained', 'base']).optional(),
  trainingSeparateModels: z.boolean().optional(),
});

// Developer mode settings schema
const developerModeSchema = z.object({
  enabled: z.boolean(),
  confirmed: z.boolean().optional(),
});

// Get developer mode status
router.get('/developer-mode', requireTrainingAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        developerModeEnabled: true,
        developerModeConfirmedAt: true,
      },
    });

    res.json({
      enabled: settings?.developerModeEnabled ?? false,
      confirmedAt: settings?.developerModeConfirmedAt ?? null,
    });
  } catch (error) {
    next(error);
  }
});

// Update developer mode
router.put('/developer-mode', requireTrainingAccess, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const payload = developerModeSchema.parse(req.body);

    // If enabling, require confirmation
    if (payload.enabled && !payload.confirmed) {
      return res.status(400).json({
        error: 'Confirmation required to enable developer mode',
        message: 'You must confirm that you understand the risks before enabling developer mode.',
      });
    }

    const updateData: any = {
      developerModeEnabled: payload.enabled,
    };

    if (payload.enabled && payload.confirmed) {
      updateData.developerModeConfirmedAt = new Date();
    } else if (!payload.enabled) {
      updateData.developerModeConfirmedAt = null;
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

    logger.info({
      operation: 'developer_mode_updated',
      message: 'Developer mode updated',
      context: {
        userId,
        enabled: payload.enabled,
      },
    });

    res.json({
      message: 'Developer mode updated successfully',
      enabled: payload.enabled,
      confirmedAt: payload.enabled ? new Date() : null,
    });
  } catch (error) {
    next(error);
  }
});

// Onboarding state schema
const onboardingStateSchema = z.object({
  flightAdded: z.boolean().optional(),
  usedFilter: z.boolean().optional(),
  exported: z.boolean().optional(),
  mapExplored: z.boolean().optional(),
  statsViewed: z.boolean().optional(),
  achievementsViewed: z.boolean().optional(),
  dismissed: z.boolean().optional(),
}).partial();

const defaultOnboardingState = {
  flightAdded: false,
  usedFilter: false,
  exported: false,
  mapExplored: false,
  statsViewed: false,
  achievementsViewed: false,
  dismissed: false,
};

// Get onboarding state
router.get('/onboarding-state', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { data: true },
    });

    if (!settings || !settings.data || typeof settings.data !== 'object') {
      return res.json(defaultOnboardingState);
    }

    const data = settings.data as any;
    const onboardingState = data.onboarding || defaultOnboardingState;

    // Merge with defaults to ensure all fields are present
    const merged = {
      ...defaultOnboardingState,
      ...onboardingState,
    };

    res.json(merged);
  } catch (error) {
    next(error);
  }
});

// Update onboarding state
router.put('/onboarding-state', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const payload = onboardingStateSchema.parse(req.body);

    const existing = await prisma.userSettings.findUnique({
      where: { userId },
      select: { data: true },
    });

    const currentData = existing?.data && typeof existing.data === 'object' 
      ? (existing.data as any) 
      : {};

    const currentOnboarding = currentData.onboarding || defaultOnboardingState;
    const updatedOnboarding = {
      ...defaultOnboardingState,
      ...currentOnboarding,
      ...payload,
    };

    const updatedData = {
      ...currentData,
      onboarding: updatedOnboarding,
    };

    await prisma.userSettings.upsert({
      where: { userId },
      update: { data: updatedData as any },
      create: {
        userId,
        data: {
          ...defaultSettings,
          onboarding: updatedOnboarding,
        } as any,
      },
    });

    res.json(updatedOnboarding);
  } catch (error) {
    next(error);
  }
});

// Get training settings
router.get('/training', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: {
        useTrainedModels: true,
        preferredEmailModel: true,
        preferredVisionModel: true,
        trainingSeparateModels: true,
      },
    });

    res.json({
      useTrainedModels: settings?.useTrainedModels ?? true,
      preferredEmailModel: settings?.preferredEmailModel ?? 'auto',
      preferredVisionModel: settings?.preferredVisionModel ?? 'auto',
      trainingSeparateModels: settings?.trainingSeparateModels ?? true,
    });
  } catch (error) {
    next(error);
  }
});

// Update training settings
router.put('/training', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const payload = trainingSettingsSchema.parse(req.body);

    const updateData: any = {};

    if (payload.useTrainedModels !== undefined) {
      updateData.useTrainedModels = payload.useTrainedModels;
    }
    if (payload.preferredEmailModel !== undefined) {
      updateData.preferredEmailModel = payload.preferredEmailModel;
    }
    if (payload.preferredVisionModel !== undefined) {
      updateData.preferredVisionModel = payload.preferredVisionModel;
    }
    if (payload.trainingSeparateModels !== undefined) {
      updateData.trainingSeparateModels = payload.trainingSeparateModels;
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
        trainingSeparateModels: payload.trainingSeparateModels ?? true,
      },
      select: {
        useTrainedModels: true,
        preferredEmailModel: true,
        preferredVisionModel: true,
        trainingSeparateModels: true,
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

// API Keys schema
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

// Get API keys (returns status only, not actual keys)
router.get('/api-keys', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;

    // Try to get user settings - handle case where fields might not exist
    let settings: any = null;
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
    } catch (error: any) {
      // If fields don't exist, settings will be null
      if (error.code !== 'P2009' && error.code !== 'P2025') {
        throw error;
      }
      logger.warn({
        operation: 'get_api_keys_user_settings_error',
        message: 'Failed to get user settings, fields might not exist',
        error: error.message,
      });
    }

    // Get admin settings to check for shared keys
    let adminSettings: any = null;
    try {
      adminSettings = await prisma.adminSettings.findFirst();
    } catch (error: any) {
      logger.warn({
        operation: 'get_api_keys_admin_settings_error',
        message: 'Failed to get admin settings',
        error: error.message,
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
    } catch (error: any) {
      logger.warn({
        operation: 'get_api_keys_access_check_error',
        message: 'Failed to check API key access',
        error: error.message,
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

// Update API keys
router.put('/api-keys', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const payload = apiKeysSchema.parse(req.body);

    // Get admin settings to check permissions
    const adminSettings = await prisma.adminSettings.findFirst();
    const allowUserApiKeys = adminSettings?.allowUserApiKeys ?? true;
    const allowUserFlightApiKeys = adminSettings?.allowUserFlightApiKeys ?? true;

    const updateData: any = {};

    // Encrypt parser API keys before storing
    if (payload.openaiApiKey !== undefined) {
      if (!allowUserApiKeys) {
        return res.status(403).json({
          error: 'User API keys are not allowed by administrator',
        });
      }
      updateData.openaiApiKey = encryptApiKey(payload.openaiApiKey);
    }
    if (payload.claudeApiKey !== undefined) {
      if (!allowUserApiKeys) {
        return res.status(403).json({
          error: 'User API keys are not allowed by administrator',
        });
      }
      updateData.claudeApiKey = encryptApiKey(payload.claudeApiKey);
    }

    // Encrypt flight lookup API keys before storing
    if (payload.airlabsApiKey !== undefined) {
      if (!allowUserFlightApiKeys) {
        return res.status(403).json({
          error: 'User flight API keys are not allowed by administrator',
        });
      }
      updateData.airlabsApiKey = encryptApiKey(payload.airlabsApiKey);
    }
    if (payload.aviationstackApiKey !== undefined) {
      if (!allowUserFlightApiKeys) {
        return res.status(403).json({
          error: 'User flight API keys are not allowed by administrator',
        });
      }
      updateData.aviationstackApiKey = encryptApiKey(payload.aviationstackApiKey);
    }
    if (payload.openskyClientId !== undefined) {
      if (!allowUserFlightApiKeys) {
        return res.status(403).json({
          error: 'User flight API keys are not allowed by administrator',
        });
      }
      updateData.openskyClientId = encryptApiKey(payload.openskyClientId);
    }
    if (payload.openskyClientSecret !== undefined) {
      if (!allowUserFlightApiKeys) {
        return res.status(403).json({
          error: 'User flight API keys are not allowed by administrator',
        });
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

// Test API key endpoints
router.post('/api-keys/test/openai', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = req.body;
    const result = await testOpenAIKey(apiKey, req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api-keys/test/claude', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = req.body;
    const result = await testClaudeKey(apiKey, req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api-keys/test/airlabs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = req.body;
    const result = await testAirlabsKey(apiKey, req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api-keys/test/aviationstack', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = req.body;
    const result = await testAviationstackKey(apiKey, req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api-keys/test/opensky', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { clientId, clientSecret, username, password } = req.body;
    const result = await testOpenSkyCredentials(
      { clientId, clientSecret, username, password },
      req.user!.id
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
