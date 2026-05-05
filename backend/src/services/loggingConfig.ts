import { prisma, setDbQueryLoggingEnabled } from '../db';
import { systemLogger } from '../utils/logger';
import { CACHE_TTL, LOGGING_DEFAULTS } from '../config/constants';

/**
 * Logging Configuration Service
 *
 * Manages logging settings from AdminSettings database.
 * Provides caching to avoid excessive database queries.
 */

export interface LogConfig {
  logLevel: string;
  maxLogFileSize: number;
  maxLogFiles: number;
  logHttpRequests: boolean;
  logDatabaseQueries: boolean;
  logParserOperations: boolean;
  logRetentionDays: number;
}

// Cache for logging config (5 minute TTL to reduce DB load)
let configCache: LogConfig | null = null;
let cacheTimestamp: number = 0;
const LOGGING_CACHE_TTL = CACHE_TTL.LOGGING_CONFIG;

/**
 * Get current logging configuration from database
 * Uses caching to minimize DB queries
 */
export async function getLoggingConfig(): Promise<LogConfig> {
  const now = Date.now();

  // Return cached config if still valid
  if (configCache && now - cacheTimestamp < LOGGING_CACHE_TTL) {
    return configCache;
  }

  try {
    const settings = await prisma.adminSettings.findFirst();

    const config: LogConfig = {
      logLevel: settings?.logLevel ?? 'info',
      maxLogFileSize: settings?.maxLogFileSize ?? LOGGING_DEFAULTS.MAX_LOG_FILE_SIZE_MB,
      maxLogFiles: settings?.maxLogFiles ?? LOGGING_DEFAULTS.MAX_LOG_FILES,
      logHttpRequests: settings?.logHttpRequests ?? false,
      logDatabaseQueries: settings?.logDatabaseQueries ?? false,
      logParserOperations: settings?.logParserOperations ?? false,
      logRetentionDays: settings?.logRetentionDays ?? LOGGING_DEFAULTS.LOG_RETENTION_DAYS,
    };

    // Update cache
    configCache = config;
    cacheTimestamp = now;

    return config;
  } catch (error) {
    systemLogger.error({
      operation: 'get_logging_config_failed',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    // Return defaults on error
    return {
      logLevel: 'info',
      maxLogFileSize: LOGGING_DEFAULTS.MAX_LOG_FILE_SIZE_MB,
      maxLogFiles: LOGGING_DEFAULTS.MAX_LOG_FILES,
      logHttpRequests: false,
      logDatabaseQueries: false,
      logParserOperations: false,
      logRetentionDays: LOGGING_DEFAULTS.LOG_RETENTION_DAYS,
    };
  }
}

/**
 * Update logging configuration in database
 * Invalidates cache to ensure fresh reads
 */
export async function updateLoggingConfig(updates: Partial<LogConfig>): Promise<LogConfig> {
  try {
    // Get or create admin settings
    let settings = await prisma.adminSettings.findFirst();

    if (!settings) {
      // Create initial admin settings if not exists
      settings = await prisma.adminSettings.create({
        data: {
          ...updates,
        },
      });
    } else {
      // Update existing settings
      settings = await prisma.adminSettings.update({
        where: { id: settings.id },
        data: updates,
      });
    }

    // Invalidate cache
    configCache = null;

    // Mirror to the sync flag in db.ts so the prisma middleware picks up
    // the new value immediately without waiting for the 30s refresh tick.
    const isDebugLevel =
      (settings.logLevel === 'debug' || settings.logLevel === 'trace');
    setDbQueryLoggingEnabled(Boolean(settings.logDatabaseQueries) && isDebugLevel);

    systemLogger.info({
      operation: 'logging_config_updated',
      context: {
        updates,
      },
    });

    // Return fresh config
    return getLoggingConfig();
  } catch (error) {
    systemLogger.error({
      operation: 'update_logging_config_failed',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw error;
  }
}

/**
 * Toggle debug logging on/off (convenience method)
 * Sets logLevel to 'debug' when enabled, 'info' when disabled
 */
export async function toggleDebugLogging(enabled: boolean): Promise<void> {
  await updateLoggingConfig({ logLevel: enabled ? 'debug' : 'info' });

  systemLogger.info({
    operation: 'debug_logging_toggled',
    context: {
      enabled,
    },
  });
}

/**
 * Check if debug logging is currently enabled
 * Fast check with caching
 */
export async function isDebugEnabled(): Promise<boolean> {
  const config = await getLoggingConfig();
  return config.logLevel === 'debug' || config.logLevel === 'trace';
}

/**
 * Check if HTTP request logging is enabled
 */
export async function shouldLogHttpRequests(): Promise<boolean> {
  const config = await getLoggingConfig();
  const isDebugLevel = config.logLevel === 'debug' || config.logLevel === 'trace';
  return config.logHttpRequests && isDebugLevel;
}

/**
 * Check if database query logging is enabled
 */
export async function shouldLogDatabaseQueries(): Promise<boolean> {
  const config = await getLoggingConfig();
  const isDebugLevel = config.logLevel === 'debug' || config.logLevel === 'trace';
  return config.logDatabaseQueries && isDebugLevel;
}

/**
 * Check if parser operation logging is enabled
 */
export async function shouldLogParserOperations(): Promise<boolean> {
  const config = await getLoggingConfig();
  const isDebugLevel = config.logLevel === 'debug' || config.logLevel === 'trace';
  return config.logParserOperations && isDebugLevel;
}

/**
 * Invalidate configuration cache (use after manual DB updates)
 */
export function invalidateCache(): void {
  configCache = null;
  cacheTimestamp = 0;
}

/**
 * Invalidate configuration cache and reinitialize logger streams
 * Call this after updating logging config to apply changes immediately
 */
export async function invalidateCacheAndReinit(): Promise<void> {
  invalidateCache();

  // Reinitialize logger streams with new config
  const { reinitializeCategoryStreams } = await import('../utils/logger');
  await reinitializeCategoryStreams();
}
