import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';
import { decryptApiKey, encryptApiKey } from '../utils/encryption';
import logger from '../utils/logger';
import { adminExportLimiter } from '../middleware/rateLimit';

// ---- Admin update data interfaces ----
interface AirlineStat {
  airline: string;
  total: number;
  hits: number;
  hitRate: number;
  commonMissingFields: string[];
}

interface ParseLogStatsResponse {
  totalLogs: number;
  overallHitRate: number;
  byAirline: AirlineStat[];
}

interface TrainingConfigUpdateData {
  trainingModelOutputDir?: string | null;
  trainingEmailModelName?: string | null;
  trainingVisionModelName?: string | null;
}

interface GlobalApiKeysUpdateData {
  globalAirlabsApiKey?: string | null;
  globalAviationstackApiKey?: string | null;
  globalOpenskyClientId?: string | null;
  globalOpenskyClientSecret?: string | null;
  globalOpenskyUsername?: string | null;
  globalOpenskyPassword?: string | null;
  allowUserFlightApiKeys?: boolean;
  requireUserFlightApiKeys?: boolean;
}

interface ParserSettingsUpdateData {
  globalOpenaiApiKey?: string | null;
  globalClaudeApiKey?: string | null;
  allowUserApiKeys?: boolean;
  requireUserApiKeys?: boolean;
  defaultVisionParser?: string;
  defaultTextParser?: string;
}

interface FeedbackPayload {
  provider?: string;
  sourceType?: string;
  [key: string]: unknown;
}
import {
  getLoggingConfig,
  updateLoggingConfig,
  toggleDebugLogging,
  invalidateCacheAndReinit,
} from '../services/loggingConfig';
import {
  listLogFiles,
  readLogFile,
  deleteLogFile,
  cleanupOldLogs,
  getLogStats,
  searchLogs,
  getLogFilePathForDownload,
} from '../services/logManager';
import {
  loggingConfigSchema,
  toggleDebugLoggingSchema,
  readLogFileQuerySchema,
  searchLogsQuerySchema,
} from '../schemas/admin';
import { getParserFeedbackStats } from '../services/parserFeedback';
import {
  testOpenAIKey,
  testClaudeKey,
  testAirlabsKey,
  testAviationstackKey,
  testOpenSkyCredentials,
} from '../services/apiKeyTester';
import { analyzeFeedbackForPatterns, getPatternAnalysisSummary } from '../services/patternAnalyzer';
import {
  getPendingPatternSuggestions,
  applyPatternSuggestion,
  autoApplyHighConfidencePatterns,
  getPatternUpdateStats,
} from '../services/patternUpdater';
import { getHardwareInfo } from '../services/hardwareService';
import smtpRouter from './admin/smtp';

// ---- Zod validation schemas ----
const trainingAccessSchema = z.object({
  canTrainLLM: z.boolean(),
});

const createInvitationSchema = z.object({
  email: z.string().email('Invalid email address').optional(),
  expiresInDays: z.number().int().min(1).max(90).optional().default(7),
});

const parserSettingsSchema = z.object({
  globalOpenaiApiKey: z.string().nullable().optional(),
  globalClaudeApiKey: z.string().nullable().optional(),
  allowUserApiKeys: z.boolean().optional(),
  requireUserApiKeys: z.boolean().optional(),
  defaultVisionParser: z.string().optional(),
  defaultTextParser: z.string().optional(),
});

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

// All routes require authentication and admin privileges
router.use(authenticate);
router.use(requireAdmin);

// Get system information
router.get('/system/info', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userCount = await prisma.user.count();
    const activeUserCount = await prisma.user.count({ where: { isActive: true } });
    const flightCount = await prisma.flight.count();
    const maxUsers = parseInt(process.env.MAX_USERS || '10');
    const allowRegistration = process.env.ALLOW_REGISTRATION !== 'false';

    // Check for demo user
    const demoUser = await prisma.user.findUnique({
      where: { username: 'demo' },
      select: { id: true, isActive: true },
    });

  res.json({
    instanceName: process.env.INSTANCE_NAME || 'TravStats',
    userCount,
    activeUserCount,
    flightCount,
      maxUsers,
      warningThreshold: userCount >= maxUsers,
      registrationEnabled: allowRegistration,
      demoUserExists: !!demoUser,
      demoUserActive: demoUser?.isActive || false,
    version: '1.0.0',
  });
  } catch (error) {
    next(error);
  }
});

// Get hardware information
router.get('/system/hardware', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const hardwareInfo = await getHardwareInfo();
    res.json(hardwareInfo);
  } catch (error) {
    next(error);
  }
});

// Get all users
router.get('/users', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        isAdmin: true,
        isActive: true,
        canTrainLLM: true,
        invitedBy: true,
        createdAt: true,
        _count: {
          select: {
            flights: true,
            userAchievements: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ users });
  } catch (error) {
    next(error);
  }
});

// Toggle user active status
router.patch('/users/:id/toggle-active', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Prevent deactivating yourself
    if (id === req.userId) {
      throw new AppError('Cannot deactivate your own account', 400);
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { isActive: true },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive },
      select: {
        id: true,
        username: true,
        isAdmin: true,
        isActive: true,
      },
    });

    res.json({ user: updatedUser });
  } catch (error) {
    next(error);
  }
});

// Update user training access
router.put('/users/:id/training-access', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { canTrainLLM } = trainingAccessSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, isAdmin: true },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Admins always have training access, so this is only for non-admins
    if (user.isAdmin) {
      return res.json({
        message: 'Admin users always have training access',
        user: {
          ...user,
          canTrainLLM: true,
        },
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { canTrainLLM },
      select: {
        id: true,
        username: true,
        isAdmin: true,
        canTrainLLM: true,
      },
    });

    res.json({
      message: `Training access ${canTrainLLM ? 'granted' : 'revoked'} for user`,
      user: updatedUser,
    });
  } catch (error) {
    next(error);
  }
});

// Create invitation
router.post('/invitations', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { email, expiresInDays } = createInvitationSchema.parse(req.body);
    const token = crypto.randomBytes(32).toString('hex');

    const invitation = await prisma.invitation.create({
      data: {
        email,
        token,
        createdBy: req.userId!,
        expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
      },
    });

    // Generate invitation URL
    const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:3000';
    const inviteUrl = `${frontendUrl}/register?token=${token}`;

    res.json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
      },
      inviteUrl,
    });
  } catch (error) {
    next(error);
  }
});

// List invitations
router.get('/invitations', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const invitations = await prisma.invitation.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        token: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
        creator: {
          select: {
            username: true,
          },
        },
      },
    });

    res.json({ invitations });
  } catch (error) {
    next(error);
  }
});

// Export all data (for backup)
router.get('/export/all-data', adminExportLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        flights: true,
        userAchievements: {
          include: {
            achievement: true,
          },
        },
        settings: true,
      },
    });

    const exportData = {
      exportedAt: new Date().toISOString(),
      instanceName: process.env.INSTANCE_NAME || 'TravStats',
      users,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="travstats-backup-${Date.now()}.json"`);
    res.json(exportData);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/admin/parse-logs/stats — aggregate parse log stats per airline
router.get('/parse-logs/stats', requireAdmin, async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const logs = await prisma.parseTrainingLog.findMany({
      select: { airline: true, templateHit: true, missingFields: true },
      take: 10000, // safety cap for large deployments
      orderBy: { createdAt: 'desc' },
    });
    const totalLogs = logs.length;

    const airlineMap = new Map<string, { total: number; hits: number; missingCounts: Map<string, number> }>();

    for (const log of logs) {
      const key = log.airline ?? 'Unknown';
      if (!airlineMap.has(key)) {
        airlineMap.set(key, { total: 0, hits: 0, missingCounts: new Map() });
      }
      const entry = airlineMap.get(key)!;
      entry.total++;
      if (log.templateHit) entry.hits++;
      for (const field of log.missingFields) {
        entry.missingCounts.set(field, (entry.missingCounts.get(field) ?? 0) + 1);
      }
    }

    const overallHits = logs.filter(l => l.templateHit).length;
    const overallHitRate = totalLogs > 0 ? Math.round((overallHits / totalLogs) * 100) : 0;

    const byAirline: AirlineStat[] = [...airlineMap.entries()].map(([airline, stats]) => {
      const commonMissingFields = [...stats.missingCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([field]) => field);
      return {
        airline,
        total: stats.total,
        hits: stats.hits,
        hitRate: stats.total > 0 ? Math.round((stats.hits / stats.total) * 100) : 0,
        commonMissingFields,
      };
    }).sort((a, b) => b.total - a.total);

    const response: ParseLogStatsResponse = { totalLogs, overallHitRate, byAirline };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

// Get admin parser settings
router.get('/parser-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Get or create admin settings (ID is always 1 for singleton)
    let adminSettings = await prisma.adminSettings.findFirst();

    if (!adminSettings) {
      // Create default admin settings if they don't exist
      adminSettings = await prisma.adminSettings.create({
        data: {
          allowUserApiKeys: true,
          requireUserApiKeys: false,
          defaultVisionParser: 'auto',
          defaultTextParser: 'auto',
        },
      });
    }

    // Return settings (API keys are decrypted for frontend)
    res.json({
      globalOpenaiApiKey: decryptApiKey(adminSettings.globalOpenaiApiKey) || undefined,
      globalClaudeApiKey: decryptApiKey(adminSettings.globalClaudeApiKey) || undefined,
      globalAirlabsApiKey: decryptApiKey(adminSettings.globalAirlabsApiKey) || undefined,
      globalAviationstackApiKey: decryptApiKey(adminSettings.globalAviationstackApiKey) || undefined,
      globalOpenskyClientId: decryptApiKey(adminSettings.globalOpenskyClientId) || undefined,
      globalOpenskyClientSecret: decryptApiKey(adminSettings.globalOpenskyClientSecret) || undefined,
      globalOpenskyUsername: decryptApiKey(adminSettings.globalOpenskyUsername) || undefined,
      globalOpenskyPassword: decryptApiKey(adminSettings.globalOpenskyPassword) || undefined,
      allowUserApiKeys: adminSettings.allowUserApiKeys,
      requireUserApiKeys: adminSettings.requireUserApiKeys,
      allowUserFlightApiKeys: adminSettings.allowUserFlightApiKeys,
      requireUserFlightApiKeys: adminSettings.requireUserFlightApiKeys,
      defaultVisionParser: adminSettings.defaultVisionParser,
      defaultTextParser: adminSettings.defaultTextParser,
    });
  } catch (error) {
    next(error);
  }
});

// Training configuration schema (defined once at module level)
const trainingConfigSchema = z.object({
  trainingModelOutputDir: z.string().optional().nullable().refine(
    (val) => !val || (val.length > 0 && val.length <= 500 && /^[a-zA-Z0-9/._-]+$/.test(val)),
    { message: 'Invalid path format (max 500 chars, alphanumeric, /, ., _, - only)' }
  ),
  trainingEmailModelName: z.string().optional().nullable().refine(
    (val) => !val || (val.length > 0 && val.length <= 100 && /^[a-zA-Z0-9._-]+$/.test(val)),
    { message: 'Invalid model name format (max 100 chars, alphanumeric, ., _, - only)' }
  ),
  trainingVisionModelName: z.string().optional().nullable().refine(
    (val) => !val || (val.length > 0 && val.length <= 100 && /^[a-zA-Z0-9._-]+$/.test(val)),
    { message: 'Invalid model name format (max 100 chars, alphanumeric, ., _, - only)' }
  ),
});

// Get training configuration
router.get('/training-config', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminSettings = await prisma.adminSettings.findFirst();
    const { getTrainingConfig } = await import('../services/trainingService');
    const trainingConfig = await getTrainingConfig();

    res.json({
      trainingModelOutputDir: adminSettings?.trainingModelOutputDir || null,
      trainingEmailModelName: adminSettings?.trainingEmailModelName || null,
      trainingVisionModelName: adminSettings?.trainingVisionModelName || null,
      // Current effective values (from ENV if not set in admin)
      currentTrainingModelOutputDir: trainingConfig.modelOutputDir,
      currentTrainingEmailModelName: trainingConfig.emailModelName,
      currentTrainingVisionModelName: trainingConfig.visionModelName,
      // ENV fallback values
      envTrainingModelOutputDir: process.env.TRAINING_MODEL_OUTPUT_DIR || './data/training/models',
      envTrainingEmailModelName: process.env.TRAINING_EMAIL_MODEL_NAME || 'travstats-email-custom',
      envTrainingVisionModelName: process.env.TRAINING_VISION_MODEL_NAME || 'travstats-vision-custom',
    });
  } catch (error) {
    next(error);
  }
});

// Update training configuration
router.put('/training-config', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const payload = trainingConfigSchema.parse(req.body);

    const updateData: TrainingConfigUpdateData = {};

    if (payload.trainingModelOutputDir !== undefined) {
      updateData.trainingModelOutputDir = payload.trainingModelOutputDir || null;
    }
    if (payload.trainingEmailModelName !== undefined) {
      updateData.trainingEmailModelName = payload.trainingEmailModelName || null;
    }
    if (payload.trainingVisionModelName !== undefined) {
      updateData.trainingVisionModelName = payload.trainingVisionModelName || null;
    }

    let adminSettings = await prisma.adminSettings.findFirst();

    if (adminSettings) {
      adminSettings = await prisma.adminSettings.update({
        where: { id: adminSettings.id },
        data: updateData,
      });
    } else {
      adminSettings = await prisma.adminSettings.create({
        data: {
          allowUserApiKeys: true,
          requireUserApiKeys: false,
          defaultVisionParser: 'auto',
          defaultTextParser: 'auto',
          ...updateData,
        },
      });
    }

    logger.info({
      operation: 'training_config_updated',
      message: 'Training configuration updated',
      context: {
        userId: req.userId,
        settings: updateData,
      },
    });

    // Get updated effective values
    const { getTrainingConfig } = await import('../services/trainingService');
    const trainingConfig = await getTrainingConfig();

    res.json({
      message: 'Training configuration updated successfully',
      settings: {
        trainingModelOutputDir: adminSettings.trainingModelOutputDir,
        trainingEmailModelName: adminSettings.trainingEmailModelName,
        trainingVisionModelName: adminSettings.trainingVisionModelName,
        currentTrainingModelOutputDir: trainingConfig.modelOutputDir,
        currentTrainingEmailModelName: trainingConfig.emailModelName,
        currentTrainingVisionModelName: trainingConfig.visionModelName,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Global API keys schema
const globalApiKeysSchema = z.object({
  globalAirlabsApiKey: z.string().optional().nullable(),
  globalAviationstackApiKey: z.string().optional().nullable(),
  globalOpenskyClientId: z.string().optional().nullable(),
  globalOpenskyClientSecret: z.string().optional().nullable(),
  globalOpenskyUsername: z.string().optional().nullable(),
  globalOpenskyPassword: z.string().optional().nullable(),
  allowUserFlightApiKeys: z.boolean().optional(),
  requireUserFlightApiKeys: z.boolean().optional(),
}).partial();

// Get global API keys
router.get('/api-keys', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
        requireUserFlightApiKeys: false,
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
      requireUserFlightApiKeys: adminSettings.requireUserFlightApiKeys ?? false,
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
router.put('/api-keys', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    if (payload.requireUserFlightApiKeys !== undefined) {
      updateData.requireUserFlightApiKeys = payload.requireUserFlightApiKeys;
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
          requireUserApiKeys: false,
          defaultVisionParser: 'auto',
          defaultTextParser: 'auto',
          allowUserFlightApiKeys: true,
          requireUserFlightApiKeys: false,
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
        requireUserFlightApiKeys: adminSettings.requireUserFlightApiKeys,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Update admin parser settings
router.put('/parser-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      globalOpenaiApiKey,
      globalClaudeApiKey,
      allowUserApiKeys,
      requireUserApiKeys,
      defaultVisionParser,
      defaultTextParser,
    } = parserSettingsSchema.parse(req.body);

    // Get or create admin settings
    let adminSettings = await prisma.adminSettings.findFirst();

    const updateData: ParserSettingsUpdateData = {};

    // Only update fields that are provided
    // Encrypt API keys before storing
    if (globalOpenaiApiKey !== undefined) {
      updateData.globalOpenaiApiKey = encryptApiKey(globalOpenaiApiKey);
    }
    if (globalClaudeApiKey !== undefined) {
      updateData.globalClaudeApiKey = encryptApiKey(globalClaudeApiKey);
    }
    if (allowUserApiKeys !== undefined) {
      updateData.allowUserApiKeys = allowUserApiKeys;
    }
    if (requireUserApiKeys !== undefined) {
      updateData.requireUserApiKeys = requireUserApiKeys;
    }
    if (defaultVisionParser !== undefined) {
      updateData.defaultVisionParser = defaultVisionParser;
    }
    if (defaultTextParser !== undefined) {
      updateData.defaultTextParser = defaultTextParser;
    }

    if (adminSettings) {
      // Update existing settings
      adminSettings = await prisma.adminSettings.update({
        where: { id: adminSettings.id },
        data: updateData,
      });
    } else {
      // Create new settings with provided data
      adminSettings = await prisma.adminSettings.create({
        data: {
          globalOpenaiApiKey: encryptApiKey(globalOpenaiApiKey),
          globalClaudeApiKey: encryptApiKey(globalClaudeApiKey),
          allowUserApiKeys: allowUserApiKeys ?? true,
          requireUserApiKeys: requireUserApiKeys ?? false,
          allowUserFlightApiKeys: true,
          requireUserFlightApiKeys: false,
          defaultVisionParser: defaultVisionParser || 'auto',
          defaultTextParser: defaultTextParser || 'auto',
        },
      });
    }

    res.json({
      message: 'Parser settings updated successfully',
      settings: {
        globalOpenaiApiKey: decryptApiKey(adminSettings.globalOpenaiApiKey) || undefined,
        globalClaudeApiKey: decryptApiKey(adminSettings.globalClaudeApiKey) || undefined,
        allowUserApiKeys: adminSettings.allowUserApiKeys,
        requireUserApiKeys: adminSettings.requireUserApiKeys,
        defaultVisionParser: adminSettings.defaultVisionParser,
        defaultTextParser: adminSettings.defaultTextParser,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ========== LOGGING ENDPOINTS ==========

// Get logging configuration
router.get('/logging/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config = await getLoggingConfig();
    res.json(config);
  } catch (error) {
    next(error);
  }
});

// Update logging configuration
router.put('/logging/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validatedData = loggingConfigSchema.parse(req.body);
    const updated = await updateLoggingConfig(validatedData);

    // Reinitialize logger streams with new config
    await invalidateCacheAndReinit();

    res.json({
      message: 'Logging configuration updated successfully',
      config: updated,
    });
  } catch (error) {
    next(error);
  }
});

// Toggle debug logging (convenience endpoint)
router.post('/logging/toggle-debug', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { enabled } = toggleDebugLoggingSchema.parse(req.body);
    await toggleDebugLogging(enabled);

    // Reinitialize logger streams with new config
    await invalidateCacheAndReinit();

    res.json({
      message: `Debug logging ${enabled ? 'enabled' : 'disabled'}`,
      debugLoggingEnabled: enabled,
    });
  } catch (error) {
    next(error);
  }
});

// List log files
router.get('/logging/files', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const files = await listLogFiles();
    res.json({ files });
  } catch (error) {
    next(error);
  }
});

// Read specific log file with filters
router.get('/logging/files/:filename', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { filename } = req.params;
    const queryParams = readLogFileQuerySchema.parse(req.query);

    const logs = await readLogFile(filename, queryParams);

    res.json({
      filename,
      entries: logs,
      count: logs.length,
      filters: queryParams,
    });
  } catch (error) {
    next(error);
  }
});

// Download log file
router.get('/logging/files/:filename/download', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { filename } = req.params;
    const filepath = getLogFilePathForDownload(filename);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.download(filepath);
  } catch (error) {
    next(error);
  }
});

// Delete log file
router.delete('/logging/files/:filename', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { filename } = req.params;
    await deleteLogFile(filename);
    res.json({
      message: `Log file ${filename} deleted successfully`,
    });
  } catch (error) {
    next(error);
  }
});

// Get logging statistics
router.get('/logging/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const stats = await getLogStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Cleanup old logs
router.post('/logging/cleanup', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deletedCount = await cleanupOldLogs();
    res.json({
      message: `Cleanup completed: ${deletedCount} file(s) deleted`,
      deletedCount,
    });
  } catch (error) {
    next(error);
  }
});

// Search logs across all files
router.get('/logging/search', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const queryParams = searchLogsQuerySchema.parse(req.query);
    const results = await searchLogs(queryParams);

    res.json({
      results,
      count: results.length,
      query: queryParams,
    });
  } catch (error) {
    next(error);
  }
});

// Get parser feedback statistics
router.get('/parser-feedback/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const provider = req.query.provider as string | undefined;
    const sourceType = req.query.sourceType as 'email' | 'boardingpass' | undefined;
    const days = parseInt(req.query.days as string) || 30;

    const stats = await getParserFeedbackStats(provider, sourceType, days);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get pattern analysis and suggestions
router.get('/parser-feedback/patterns', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const [suggestions, summary, pendingSuggestions, stats] = await Promise.all([
      analyzeFeedbackForPatterns(days),
      getPatternAnalysisSummary(days),
      getPendingPatternSuggestions(),
      getPatternUpdateStats(),
    ]);
    res.json({
      suggestions,
      summary,
      pendingSuggestions,
      stats,
    });
  } catch (error) {
    next(error);
  }
});

const applyPatternSchema = z.object({
  autoApply: z.boolean().optional(),
});

const autoApplySchema = z.object({
  threshold: z.number().min(0).max(1).optional().default(0.9),
});

// Apply a pattern suggestion
router.post('/parser-feedback/patterns/:id/apply', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { autoApply } = applyPatternSchema.parse(req.body);
    const result = await applyPatternSuggestion(id, autoApply === true);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Auto-apply high-confidence patterns
router.post('/parser-feedback/patterns/auto-apply', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { threshold } = autoApplySchema.parse(req.body);
    const appliedCount = await autoApplyHighConfidencePatterns(threshold);
    res.json({
      success: true,
      appliedCount,
      message: `Applied ${appliedCount} high-confidence pattern(s)`,
    });
  } catch (error) {
    next(error);
  }
});

// Get detailed feedback entries
router.get('/parser-feedback/details', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const provider = req.query.provider as string | undefined;
    const sourceType = req.query.sourceType as 'email' | 'boardingpass' | undefined;
    const days = parseInt(req.query.days as string) || 30;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const since = new Date();
    since.setDate(since.getDate() - days);

    const where: Prisma.AnalyticsEventWhereInput = {
      type: 'parser_feedback',
      createdAt: {
        gte: since,
      },
    };

    const events = await prisma.analyticsEvent.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
      select: {
        id: true,
        userId: true,
        createdAt: true,
        payload: true,
      },
    });

    // Filter by provider and sourceType if provided
    const filtered = events.filter((event) => {
      const payload = event.payload as FeedbackPayload;
      if (provider && payload.provider !== provider) return false;
      if (sourceType && payload.sourceType !== sourceType) return false;
      return true;
    });

    const total = await prisma.analyticsEvent.count({ where });

    res.json({
      feedback: filtered,
      total,
    });
  } catch (error) {
    next(error);
  }
});

// Test API key endpoints (admin)
router.post('/api-keys/test/openai', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const result = await testOpenAIKey(apiKey);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api-keys/test/claude', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const result = await testClaudeKey(apiKey);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api-keys/test/airlabs', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const result = await testAirlabsKey(apiKey);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api-keys/test/aviationstack', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = testApiKeySchema.parse(req.body);
    const result = await testAviationstackKey(apiKey);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/api-keys/test/opensky', requireAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { clientId, clientSecret, username, password } = testOpenSkySchema.parse(req.body);
    const result = await testOpenSkyCredentials({ clientId, clientSecret, username, password });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ---- SMTP Configuration ----
router.use('/smtp', smtpRouter);

export default router;
