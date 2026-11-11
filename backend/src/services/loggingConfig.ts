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
/** The last `debugUntil` read successfully; what a failed read keeps armed. */
let knownDebugUntil: string | null = null;
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
    debugUntil?: Date | null;
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
    debugUntil: settings?.debugUntil?.toISOString() ?? null,
  };
}

/** Current configuration, cached for `CACHE_TTL.LOGGING_CONFIG`. */
export async function getLoggingConfig(): Promise<LogConfig> {
  const now = Date.now();
  const timerLapsed = configCache?.debugUntil && Date.parse(configCache.debugUntil) <= now;
  if (configCache && !timerLapsed && now - cacheTimestamp < CACHE_TTL.LOGGING_CONFIG) {
    return configCache;
  }

  try {
    let settings = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    // The 24 h verbose timer has run out: back to `info` before anyone reads it.
    if (settings?.debugUntil && settings.debugUntil.getTime() <= now) {
      // Conditioned on the deadline that was read: a renewal or a hand-picked level that
      // landed meanwhile is not overwritten (the update then matches nothing).
      const { count } = await prisma.adminSettings.updateMany({
        where: { id: settings.id, debugUntil: settings.debugUntil },
        data: { logLevel: "info", debugUntil: null },
      });
      if (count > 0) logger.info({ operation: "debug_logging_expired" });
      settings = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    }
    configCache = configFrom(settings);
    knownDebugUntil = configCache.debugUntil ?? null;
    cacheTimestamp = now;
    return configCache;
  } catch (error) {
    logger.error({ operation: "get_logging_config_failed", error });
    // Not cached: the next call tries the database again. The timer that was running stays
    // known, so a failed expiry is retried rather than forgotten.
    return { ...configFrom(null), debugUntil: knownDebugUntil };
  }
}

/** Store new settings and apply them to the running loggers at once. */
export async function updateLoggingConfig(
  updates: Partial<Omit<LogConfig, "effectiveLogLevel" | "logLevelSource" | "debugUntil">>,
  debugUntil?: Date | null
): Promise<LogConfig> {
  await prisma.adminSettings.update({
    where: { id: await ensureAdminSettingsRow() },
    data: {
      ...updates,
      // Picking a quiet level by hand ends a running timer; a verbose one leaves it alone.
      ...(updates.logLevel !== undefined && !isVerboseLevel(updates.logLevel)
        ? { debugUntil: null }
        : {}),
      ...(debugUntil !== undefined ? { debugUntil } : {}),
    },
  });
  invalidateCache();
  const applied = await applyLoggingConfig();
  logger.info({
    operation: "logging_config_updated",
    context: { changed: Object.keys(updates), effectiveLogLevel: applied.effectiveLogLevel },
  });
  return applied;
}

/** How long "verbose log" stays on before the server switches it off by itself. */
export const DEBUG_LOGGING_HOURS = 24;

/**
 * Settings v3 `debug24`: on means `debug` for `DEBUG_LOGGING_HOURS` hours, then the
 * server puts the level back to `info` on its own (a timer in this process, and the
 * check on every config read and at boot, so a restart cannot leave it on). Off
 * switches it at once. Turning it on again restarts the 24 hours.
 */
export async function toggleDebugLogging(enabled: boolean): Promise<LogConfig> {
  return updateLoggingConfig(
    { logLevel: enabled ? "debug" : "info" },
    enabled ? new Date(Date.now() + DEBUG_LOGGING_HOURS * 3_600_000) : null
  );
}

let debugTimer: NodeJS.Timeout | null = null;
const DEBUG_EXPIRY_RETRY_MS = 60_000;

/** (Re)arms the one timer that ends a running verbose period; never keeps the process alive. */
function scheduleDebugExpiry(debugUntil: string | null | undefined): void {
  if (debugTimer) clearTimeout(debugTimer);
  debugTimer = null;
  if (!debugUntil) return;
  // Already past: the revert failed (database down), so wait before trying again.
  const left = Date.parse(debugUntil) - Date.now();
  const delay = left > 0 ? left : DEBUG_EXPIRY_RETRY_MS;
  debugTimer = setTimeout(
    () => {
      debugTimer = null;
      invalidateCache();
      applyLoggingConfig().catch((error) =>
        logger.error({ operation: "debug_logging_expiry_failed", error })
      );
    },
    Math.min(delay, 2 ** 31 - 1)
  );
  debugTimer.unref();
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
  scheduleDebugExpiry(config.debugUntil);
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
