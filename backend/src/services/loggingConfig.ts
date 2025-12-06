import { prisma } from '../db';
import logger, { systemLogger } from '../utils/logger';

/**
 * Logging Configuration Service
 *
 * Manages logging settings from AdminSettings database.
 * Provides caching to avoid excessive database queries.
 */

export interface LogConfig {
  debugLoggingEnabled: boolean;
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
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get current logging configuration from database
 * Uses caching to minimize DB queries
 */
export async function getLoggingConfig(): Promise<LogConfig> {
  const now = Date.now();

  // Return cached config if still valid
  if (configCache && now - cacheTimestamp < CACHE_TTL) {
    return configCache;
  }

  try {
    const settings = await prisma.adminSettings.findFirst();

    const config: LogConfig = {
      debugLoggingEnabled: settings?.debugLoggingEnabled ?? false,
      logLevel: settings?.logLevel ?? 'info',
      maxLogFileSize: settings?.maxLogFileSize ?? 10,
      maxLogFiles: settings?.maxLogFiles ?? 7,
      logHttpRequests: settings?.logHttpRequests ?? false,
      logDatabaseQueries: settings?.logDatabaseQueries ?? false,
      logParserOperations: settings?.logParserOperations ?? false,
      logRetentionDays: settings?.logRetentionDays ?? 7,
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
      debugLoggingEnabled: false,
      logLevel: 'info',
      maxLogFileSize: 10,
      maxLogFiles: 7,
      logHttpRequests: false,
      logDatabaseQueries: false,
      logParserOperations: false,
      logRetentionDays: 7,
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
 */
export async function toggleDebugLogging(enabled: boolean): Promise<void> {
  await updateLoggingConfig({ debugLoggingEnabled: enabled });

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
  return config.debugLoggingEnabled;
}

/**
 * Check if HTTP request logging is enabled
 */
export async function shouldLogHttpRequests(): Promise<boolean> {
  const config = await getLoggingConfig();
  return config.logHttpRequests && config.debugLoggingEnabled;
}

/**
 * Check if database query logging is enabled
 */
export async function shouldLogDatabaseQueries(): Promise<boolean> {
  const config = await getLoggingConfig();
  return config.logDatabaseQueries && config.debugLoggingEnabled;
}

/**
 * Check if parser operation logging is enabled
 */
export async function shouldLogParserOperations(): Promise<boolean> {
  const config = await getLoggingConfig();
  return config.logParserOperations && config.debugLoggingEnabled;
}

/**
 * Invalidate configuration cache (use after manual DB updates)
 */
export function invalidateCache(): void {
  configCache = null;
  cacheTimestamp = 0;
}
