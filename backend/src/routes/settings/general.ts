import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import logger from '../../utils/logger';
import {
  SettingsDataJson,
  SettingsResponse,
  UserSettingsUpdateData,
  defaultSettings,
} from './types';

const router = Router();

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
  autoUpdate: z.object({
    enabled: z.boolean().optional(),
    requireApproval: z.boolean().optional(),
    checkInterval: z.number().min(5).max(1440).optional(), // 5 minutes to 24 hours
    onlyDuringFlight: z.boolean().optional(),
    expiryHours: z.number().min(1).max(168).optional(), // 1 hour to 1 week
  }).partial().optional(),
  historicalEnrichment: z
    .object({
      enabled: z.boolean().optional(),
      minConfidence: z.number().min(0).max(100).optional(),
      maxPerDay: z.number().min(1).max(1000).optional(),
    })
    .partial()
    .optional(),
  boardingPassParserStrategy: z.enum(['parser-only', 'parser-with-api', 'api-only']).nullable().optional(),
}).partial();

/** Build a SettingsResponse from a Prisma userSettings record */
function buildSettingsResponse(record: {
  data: Prisma.JsonValue;
  autoUpdateEnabled: boolean;
  autoUpdateRequireApproval: boolean;
  autoUpdateCheckInterval: number;
  autoUpdateOnlyDuringFlight: boolean;
  autoUpdateExpiryHours: number;
  boardingPassParserStrategy: string | null;
  historicalEnrichmentEnabled: boolean | null;
  historicalEnrichmentMinConfidence: number | null;
  historicalEnrichmentMaxPerDay: number | null;
}): SettingsResponse {
  const baseData = (typeof record.data === 'object' && record.data !== null
    ? record.data
    : {}) as SettingsDataJson;

  return {
    ...baseData,
    autoUpdate: {
      enabled: record.autoUpdateEnabled ?? false,
      requireApproval: record.autoUpdateRequireApproval ?? true,
      checkInterval: record.autoUpdateCheckInterval ?? 15,
      onlyDuringFlight: record.autoUpdateOnlyDuringFlight ?? true,
      expiryHours: record.autoUpdateExpiryHours ?? 24,
    },
    boardingPassParserStrategy: record.boardingPassParserStrategy,
    historicalEnrichment: {
      enabled: record.historicalEnrichmentEnabled ?? false,
      minConfidence: record.historicalEnrichmentMinConfidence ?? 60,
      maxPerDay: record.historicalEnrichmentMaxPerDay ?? 50,
    },
  };
}

// GET /
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
          // Initialize auto-update settings with defaults
          autoUpdateEnabled: false,
          autoUpdateRequireApproval: true,
          autoUpdateCheckInterval: 15,
          autoUpdateOnlyDuringFlight: true,
          autoUpdateExpiryHours: 24,
          // Initialize boarding pass parser strategy (null = auto)
          boardingPassParserStrategy: null,
          // Initialize historical enrichment settings with defaults
          historicalEnrichmentEnabled: false,
          historicalEnrichmentMinConfidence: 60,
          historicalEnrichmentMaxPerDay: 50,
        },
      });
      const response = buildSettingsResponse(created);
      res.json(response);
      return;
    }

    const response = buildSettingsResponse(existing);

    logger.info({
      operation: 'get_settings_response',
      autoUpdate: response.autoUpdate,
      historicalEnrichment: response.historicalEnrichment,
    });

    res.json(response);
  } catch (error) {
    next(error);
  }
});

// PUT /
router.put('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const payload = settingsSchema.parse(req.body);
    logger.info({ operation: 'settings_update', userId });

    const existing = await prisma.userSettings.findUnique({
      where: { userId },
    });

    // Extract direct fields from payload since they're not part of JSON data
    const { boardingPassParserStrategy, autoUpdate: _autoUpdate, historicalEnrichment: _historicalEnrichment, ...payloadWithoutDirectFields } = payload;

    const merged: SettingsDataJson = {
      ...defaultSettings,
      ...(typeof existing?.data === 'object' && existing.data !== null ? existing.data as SettingsDataJson : {}),
      ...payloadWithoutDirectFields,
    };

    const updateData: UserSettingsUpdateData = {
      data: merged as Prisma.InputJsonValue,
    };

    // Handle auto-update settings
    if (payload.autoUpdate) {
      logger.info({
        operation: 'updating_auto_update_settings',
        autoUpdate: payload.autoUpdate,
      });
      // Always update enabled, even if false (use 'in' operator to check if property exists)
      if ('enabled' in payload.autoUpdate) {
        updateData.autoUpdateEnabled = payload.autoUpdate.enabled;
        logger.info(`Setting autoUpdateEnabled to: ${payload.autoUpdate.enabled} (type: ${typeof payload.autoUpdate.enabled})`);
      }
      if ('requireApproval' in payload.autoUpdate) {
        updateData.autoUpdateRequireApproval = payload.autoUpdate.requireApproval;
      }
      if (payload.autoUpdate.checkInterval !== undefined) {
        updateData.autoUpdateCheckInterval = payload.autoUpdate.checkInterval;
      }
      if ('onlyDuringFlight' in payload.autoUpdate) {
        updateData.autoUpdateOnlyDuringFlight = payload.autoUpdate.onlyDuringFlight;
      }
      if (payload.autoUpdate.expiryHours !== undefined) {
        updateData.autoUpdateExpiryHours = payload.autoUpdate.expiryHours;
      }
    } else if (existing) {
      // Preserve existing auto-update settings if not in payload
      updateData.autoUpdateEnabled = existing.autoUpdateEnabled;
      updateData.autoUpdateRequireApproval = existing.autoUpdateRequireApproval;
      updateData.autoUpdateCheckInterval = existing.autoUpdateCheckInterval;
      updateData.autoUpdateOnlyDuringFlight = existing.autoUpdateOnlyDuringFlight;
      updateData.autoUpdateExpiryHours = existing.autoUpdateExpiryHours;
    }

    // Historical enrichment settings
    if (payload.historicalEnrichment) {
      logger.info({
        operation: 'updating_historical_enrichment_settings',
        historicalEnrichment: payload.historicalEnrichment,
      });
      // Always update enabled, even if false (use 'in' operator to check if property exists)
      if ('enabled' in payload.historicalEnrichment) {
        updateData.historicalEnrichmentEnabled = payload.historicalEnrichment.enabled;
        logger.info(`Setting historicalEnrichmentEnabled to: ${payload.historicalEnrichment.enabled} (type: ${typeof payload.historicalEnrichment.enabled})`);
      }
      if (payload.historicalEnrichment.minConfidence !== undefined) {
        updateData.historicalEnrichmentMinConfidence = payload.historicalEnrichment.minConfidence;
      }
      if (payload.historicalEnrichment.maxPerDay !== undefined) {
        updateData.historicalEnrichmentMaxPerDay = payload.historicalEnrichment.maxPerDay;
      }
    } else if (existing) {
      // Preserve existing historical enrichment settings if not in payload
      updateData.historicalEnrichmentEnabled = existing.historicalEnrichmentEnabled;
      updateData.historicalEnrichmentMinConfidence = existing.historicalEnrichmentMinConfidence;
      updateData.historicalEnrichmentMaxPerDay = existing.historicalEnrichmentMaxPerDay;
    }

    // Handle boarding pass parser strategy
    if (boardingPassParserStrategy !== undefined) {
      updateData.boardingPassParserStrategy = boardingPassParserStrategy;
    }

    const saved = await prisma.userSettings.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        data: merged as Prisma.InputJsonValue,
        // Initialize training settings with defaults
        useTrainedModels: true,
        preferredEmailModel: 'auto',
        preferredVisionModel: 'auto',
        // Initialize auto-update settings with defaults
        autoUpdateEnabled: payload.autoUpdate?.enabled ?? false,
        autoUpdateRequireApproval: payload.autoUpdate?.requireApproval ?? true,
        autoUpdateCheckInterval: payload.autoUpdate?.checkInterval ?? 15,
        autoUpdateOnlyDuringFlight: payload.autoUpdate?.onlyDuringFlight ?? true,
        historicalEnrichmentEnabled: payload.historicalEnrichment?.enabled ?? false,
        historicalEnrichmentMinConfidence: payload.historicalEnrichment?.minConfidence ?? 60,
        historicalEnrichmentMaxPerDay: payload.historicalEnrichment?.maxPerDay ?? 50,
        autoUpdateExpiryHours: payload.autoUpdate?.expiryHours ?? 24,
        // Initialize boarding pass parser strategy (null = auto)
        boardingPassParserStrategy: boardingPassParserStrategy ?? null,
      },
    });

    logger.info({
      operation: 'saved_settings',
      autoUpdateEnabled: saved.autoUpdateEnabled,
      historicalEnrichmentEnabled: saved.historicalEnrichmentEnabled,
    });

    // Return response with autoUpdate and historicalEnrichment settings included
    const response = buildSettingsResponse(saved);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
