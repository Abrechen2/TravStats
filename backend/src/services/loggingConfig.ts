import { prisma } from "../db";
import logger, {
  CATEGORY_FILES,
  FileCategory,
  setCategoryFileEnabled,
  setLoggerLevel,
} from "../utils/logger";
import { CACHE_TTL, LOGGING_DEFAULTS } from "../config/constants";
import { ensureAdminSettingsRow } from "./adminSettingsRow";
import { LoggingConfigResponse, LogLevelName } from "../shared/logContract";
import { isLogLevel, isVerboseLevel, resolveEffectiveLogLevel } from "../utils/logging/levelPolicy";
import { setLoggingRuntimeFlags } from "../utils/logging/runtimeFlags";
import { setRotationSizeMb } from "../utils/logging/fileStreams";

/**
 * Logging configuration: stored in `admin_settings`, APPLIED to the running
 * loggers by `applyLoggingConfig()`.
 *
 * Until 2026-09-26 the settings were only stored. The level an admin picked
 * never reached a logger, the category switches never reached a file, and the
 * request logger kept a five-minute cache of its own that a save did not clear.
 */

export type LogConfig = LoggingConfigResponse;

let configCache: LogConfig | null = null;
let cacheTimestamp = 0;

function configFrom(
  settings: {
    logLevel?: string | null;
    maxLogFileSize?: number | null;
    maxLogFiles?: number | null;
    logHttpRequests?: boolean | null;
    logDatabaseQueries?: boolean | null;
    logParserOperations?: boolean | null;
    logRetentionDays?: number | null;
  } | null
): LogConfig {
  const stored: LogLevelName = isLogLevel(settings?.logLevel) ? settings.logLevel : "info";
  // Without a row the stored level is unknown, not "info": the default applies.
  const effective = resolveEffectiveLogLevel(settings ? stored : undefined);
  return {
    logLevel: stored,
    effectiveLogLevel: effective.level,
    logLevelSource: effective.source,
    maxLogFileSize: settings?.maxLogFileSize ?? LOGGING_DEFAULTS.MAX_LOG_FILE_SIZE_MB,
    maxLogFiles: settings?.maxLogFiles ?? LOGGING_DEFAULTS.MAX_LOG_FILES,
    logHttpRequests: settings?.logHttpRequests ?? false,
    logDatabaseQueries: settings?.logDatabaseQueries ?? false,
    logParserOperations: settings?.logParserOperations ?? false,
    logRetentionDays: settings?.logRetentionDays ?? LOGGING_DEFAULTS.LOG_RETENTION_DAYS,
  };
}

/** Current configuration, cached for `CACHE_TTL.LOGGING_CONFIG`. */
export async function getLoggingConfig(): Promise<LogConfig> {
  const now = Date.now();
  if (configCache && now - cacheTimestamp < CACHE_TTL.LOGGING_CONFIG) return configCache;

  try {
    const settings = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    configCache = configFrom(settings);
    cacheTimestamp = now;
    return configCache;
  } catch (error) {
    logger.error({ operation: "get_logging_config_failed", error });
    // Not cached: the next call tries the database again.
    return configFrom(null);
  }
}

/** Store new settings and apply them to the running loggers at once. */
export async function updateLoggingConfig(
  updates: Partial<Omit<LogConfig, "effectiveLogLevel" | "logLevelSource">>
): Promise<LogConfig> {
  await prisma.adminSettings.update({
    where: { id: await ensureAdminSettingsRow() },
    data: updates,
  });
  invalidateCache();
  const applied = await applyLoggingConfig();
  logger.info({
    operation: "logging_config_updated",
    context: { changed: Object.keys(updates), effectiveLogLevel: applied.effectiveLogLevel },
  });
  return applied;
}

export async function toggleDebugLogging(enabled: boolean): Promise<LogConfig> {
  return updateLoggingConfig({ logLevel: enabled ? "debug" : "info" });
}

/**
 * Push a configuration into the running process: the level into every logger,
 * the category switches into their files, the hot-path flags into the request
 * logger and the query log. Called at boot and after every change.
 *
 * Returns the configuration that is now in force.
 */
export async function applyLoggingConfig(): Promise<LogConfig> {
  const config = await getLoggingConfig();
  const verbose = isVerboseLevel(config.effectiveLogLevel);

  setLoggerLevel(config.effectiveLogLevel);
  setRotationSizeMb(config.maxLogFileSize);

  const wanted: Record<FileCategory, boolean> = {
    // Security events are always written: they are warnings, and the file is
    // the one an admin opens after something went wrong.
    security: true,
    http: verbose && config.logHttpRequests,
    database: verbose && config.logDatabaseQueries,
    parser: verbose && config.logParserOperations,
    "parser-vision": verbose && config.logParserOperations,
    "parser-text": verbose && config.logParserOperations,
    "parser-factory": verbose && config.logParserOperations,
  };
  const unavailable: string[] = [];
  for (const category of Object.keys(CATEGORY_FILES) as FileCategory[]) {
    const attached = setCategoryFileEnabled(category, wanted[category]);
    if (wanted[category] && !attached) unavailable.push(category);
  }
  if (unavailable.length > 0) {
    logger.warn({ operation: "log_category_files_unavailable", context: { unavailable } });
  }

  setLoggingRuntimeFlags({
    httpRequests: wanted.http,
    databaseQueries: wanted.database,
  });
  return config;
}

export async function isDebugEnabled(): Promise<boolean> {
  return isVerboseLevel((await getLoggingConfig()).effectiveLogLevel);
}

export async function shouldLogHttpRequests(): Promise<boolean> {
  const config = await getLoggingConfig();
  return config.logHttpRequests && isVerboseLevel(config.effectiveLogLevel);
}

export async function shouldLogDatabaseQueries(): Promise<boolean> {
  const config = await getLoggingConfig();
  return config.logDatabaseQueries && isVerboseLevel(config.effectiveLogLevel);
}

export async function shouldLogParserOperations(): Promise<boolean> {
  const config = await getLoggingConfig();
  return config.logParserOperations && isVerboseLevel(config.effectiveLogLevel);
}

export function invalidateCache(): void {
  configCache = null;
  cacheTimestamp = 0;
}
