import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireTrainingAccess } from '../middleware/trainingAuth';
import { prisma } from '../db';
import { encryptApiKey, decryptApiKey } from '../utils/encryption';
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
    temperature: z.enum(['celsius', 'fahrenheit']).optional(),
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
}).partial();

const defaultSettings = {
  profile: { username: 'Traveler', email: 'traveler@example.com', profilePicture: null },
  display: { theme: 'light', language: 'de', timezone: 'Europe/Berlin', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  units: { distanceUnit: 'kilometers', currency: 'EUR', temperature: 'celsius' },
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
        },
      });
      return res.json(created.data);
    }

    res.json(existing.data);
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

    const saved = await prisma.userSettings.upsert({
      where: { userId },
      update: { data: merged as any },
      create: { 
        userId, 
        data: merged as any,
        // Initialize training settings with defaults
        useTrainedModels: true,
        preferredEmailModel: 'auto',
        preferredVisionModel: 'auto',
        trainingSeparateModels: true,
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

export default router;
