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
import { DOMAIN_KEYS, type DomainKey } from '../../shared/domains';
import { ECB_CURRENCIES } from '../../shared/currencies';
import { getInstanceSettings } from '../../services/instanceSettingsService';

const router = Router();

// Coerce empty string to undefined before email validation so the frontend
// can send back the cleared field without triggering a 400.
const emptyToUndef = (v: unknown): unknown => (v === '' ? undefined : v);

/**
 * The FX BASE is narrower than what you may record in. Everything converts
 * into it, so it has to be a currency with a dependable rate history — the 30
 * the ECB publishes, back to 1999. The UI states this at the field.
 */
export const baseCurrencyField = z.enum(ECB_CURRENCIES as unknown as [string, ...string[]]);

const settingsSchema = z.object({
  profile: z.object({
    username: z.string().optional(),
    // Real name (#241). Unlike everything else in this block these two do NOT
    // go into the settings JSON — they are columns on `User`, because the
    // header reads them from /auth/me. Empty string means "clear it", which is
    // why they are nullable and not run through `emptyToUndef`: dropping the
    // key would make a cleared field silently keep its old value, the exact
    // defect #198 was about.
    firstName: z.string().max(100).nullable().optional(),
    lastName: z.string().max(100).nullable().optional(),
    email: z.preprocess(emptyToUndef, z.string().email().optional()),
    // Self-hosted app behind an arbitrary domain/reverse proxy can't reliably
    // know its own public origin, so a same-origin path (e.g. the value
    // returned by POST /settings/profile-picture) is the normal case.
    // http(s):// is accepted for backwards compatibility with older rows
    // that stored an absolute URL. blob:/data: URLs are rejected — they're
    // client-local (or huge inline payloads) and don't survive a reload or
    // another device (see issue #186).
    profilePicture: z
      .string()
      .refine(
        (value) =>
          value.startsWith('https://') || value.startsWith('http://') || value.startsWith('/'),
        'Profile picture must be an HTTP(S) URL or a same-origin path'
      )
      .optional()
      .nullable(),
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
    // Any ISO 4217 alpha-3 code — see schemas/flight.ts for rationale.
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 code (e.g. EUR, USD, INR)')
      .optional(),
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
    routeColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'Must be a hex color').optional(),
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
  // Cruise-domain preferences. Own slice so the pattern stays clean when
  // hotel / POI domains add their own slices later.
  cruise: z
    .object({
      defaultLine: z.string().max(200).optional(),
      defaultCabinType: z
        .enum(['inside', 'oceanview', 'balcony', 'suite'])
        .nullable()
        .optional(),
      showCruiseArcs: z.boolean().optional(),
    })
    .partial()
    .optional(),
  boardingPassParserStrategy: z.enum(['parser-only', 'parser-with-api', 'api-only']).nullable().optional(),
  enabledDomains: z.array(z.enum(DOMAIN_KEYS as unknown as [DomainKey, ...DomainKey[]])).optional(),
  whatsNewSeenVersion: z.string().max(32).optional(),
  // Lodging-domain preference: single currency used to aggregate stay costs that
  // were originally billed in whatever currency the hotel uses.
  baseCurrency: baseCurrencyField.optional(),
}).partial();

export const settingsUpdateSchema = settingsSchema;

/**
 * Build a SettingsResponse from a Prisma userSettings record.
 *
 * `betaFeaturesEnabled` is instance-level (AdminSettings), not user-level —
 * it rides along on this payload purely so the frontend learns the value at
 * boot without a second request. It is read-only here: the write path is the
 * admin-guarded PUT /api/v1/admin/instance-settings.
 */
function buildSettingsResponse(betaFeaturesEnabled: boolean, name: {
  firstName: string | null;
  lastName: string | null;
}, record: {
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
  enabledDomains: string[];
  baseCurrency: string;
}): SettingsResponse {
  const baseData = (typeof record.data === 'object' && record.data !== null
    ? record.data
    : {}) as SettingsDataJson;

  return {
    ...baseData,
    // The name is not in the blob — it is read from the user row and merged in
    // here, so the settings page and the header cannot drift apart (#241).
    profile: {
      ...(baseData.profile ?? {}),
      firstName: name.firstName,
      lastName: name.lastName,
    },
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
    enabledDomains: record.enabledDomains,
    baseCurrency: record.baseCurrency,
    // Listed after the `...baseData` spread so a stale key that somehow made
    // it into the settings JSON can never shadow the authoritative value.
    betaFeaturesEnabled,
  };
}

// GET /
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const { betaFeaturesEnabled } = await getInstanceSettings();
    const existing = await prisma.userSettings.findUnique({
      where: { userId },
    });
    const nameRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const name = { firstName: nameRow?.firstName ?? null, lastName: nameRow?.lastName ?? null };

    if (!existing) {
      const created = await prisma.userSettings.create({
        data: {
          userId,
          data: defaultSettings,
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
      const response = buildSettingsResponse(betaFeaturesEnabled, name, created);
      res.json(response);
      return;
    }

    const response = buildSettingsResponse(betaFeaturesEnabled, name, existing);

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
    // Zod strips unknown keys, so a client PUTting `betaFeaturesEnabled` here
    // never reaches the DB — the value below is always re-read from
    // AdminSettings, never taken from the request body.
    const payload = settingsSchema.parse(req.body);
    const { enabledDomains, baseCurrency, ...rest } = payload;
    const { betaFeaturesEnabled } = await getInstanceSettings();
    logger.info({ operation: 'settings_update', userId });

    const existing = await prisma.userSettings.findUnique({
      where: { userId },
    });

    // Extract direct fields from payload since they're not part of JSON data
    const { boardingPassParserStrategy, autoUpdate: _autoUpdate, historicalEnrichment: _historicalEnrichment, ...payloadWithoutDirectFields } = rest;

    // First and last name are columns on `User`, not settings JSON — strip them
    // out of the profile block before it is merged, or a stale copy would sit
    // in the blob and shadow the row the header actually reads (#241).
    const { firstName, lastName, ...profileForBlob } = payloadWithoutDirectFields.profile ?? {};
    if (payloadWithoutDirectFields.profile) {
      payloadWithoutDirectFields.profile = profileForBlob;
    }
    // `undefined` = not mentioned, leave alone. An empty string = cleared.
    const nameUpdate: { firstName?: string | null; lastName?: string | null } = {};
    if (firstName !== undefined) nameUpdate.firstName = firstName === "" ? null : firstName;
    if (lastName !== undefined) nameUpdate.lastName = lastName === "" ? null : lastName;
    if (Object.keys(nameUpdate).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: nameUpdate });
    }

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

    // Handle enabled domains (multi-domain foundation)
    if (enabledDomains !== undefined) {
      updateData.enabledDomains = enabledDomains;
    }

    // Handle base currency (lodging-domain aggregation currency)
    if (baseCurrency !== undefined) {
      updateData.baseCurrency = baseCurrency;
    }

    const saved = await prisma.userSettings.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        data: merged as Prisma.InputJsonValue,
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
        enabledDomains: enabledDomains ?? ['flight'],
        baseCurrency: baseCurrency ?? 'EUR',
      },
    });

    logger.info({
      operation: 'saved_settings',
      autoUpdateEnabled: saved.autoUpdateEnabled,
      historicalEnrichmentEnabled: saved.historicalEnrichmentEnabled,
    });

    // Return response with autoUpdate and historicalEnrichment settings included
    const savedName = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    const response = buildSettingsResponse(
      betaFeaturesEnabled,
      { firstName: savedName?.firstName ?? null, lastName: savedName?.lastName ?? null },
      saved
    );
    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
