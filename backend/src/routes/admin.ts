import { Router, Response, NextFunction } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';
import { decryptApiKey, encryptApiKey } from '../utils/encryption';
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
import { analyzeFeedbackForPatterns, getPatternAnalysisSummary } from '../services/patternAnalyzer';
import {
  getPendingPatternSuggestions,
  applyPatternSuggestion,
  autoApplyHighConfidencePatterns,
  getPatternUpdateStats,
} from '../services/patternUpdater';
import { getHardwareInfo } from '../services/hardwareService';

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
    const { canTrainLLM } = req.body;

    if (typeof canTrainLLM !== 'boolean') {
      throw new AppError('canTrainLLM must be a boolean', 400);
    }

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
    const { email, expiresInDays = 7 } = req.body;
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
router.get('/export/all-data', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
      allowUserApiKeys: adminSettings.allowUserApiKeys,
      requireUserApiKeys: adminSettings.requireUserApiKeys,
      defaultVisionParser: adminSettings.defaultVisionParser,
      defaultTextParser: adminSettings.defaultTextParser,
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
    } = req.body;

    // Get or create admin settings
    let adminSettings = await prisma.adminSettings.findFirst();

    const updateData: any = {};

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

// Apply a pattern suggestion
router.post('/parser-feedback/patterns/:id/apply', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { autoApply } = req.body;
    const result = await applyPatternSuggestion(id, autoApply === true);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Auto-apply high-confidence patterns
router.post('/parser-feedback/patterns/auto-apply', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const threshold = parseFloat(req.body.threshold as string) || 0.9;
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

    const where: any = {
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
      const payload = event.payload as any;
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

export default router;
