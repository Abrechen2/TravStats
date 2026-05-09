import { PrismaClient } from '@prisma/client';
import { dbLogger } from './utils/logger';
import { shouldLogDatabaseQueries } from './services/loggingConfig';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Sync flag refreshed every 30s in the background. The previous middleware
// awaited shouldLogDatabaseQueries() on every query, which adds a microtask
// per call even when the underlying value comes from a cache. Reading a
// boolean is free; the refresh runs out-of-band.
let dbQueryLoggingEnabled = false;
let dbQueryLoggingTimer: NodeJS.Timeout | null = null;

async function refreshDbQueryLoggingFlag(): Promise<void> {
  try {
    dbQueryLoggingEnabled = await shouldLogDatabaseQueries();
  } catch {
    dbQueryLoggingEnabled = false;
  }
}

if (process.env.NODE_ENV !== 'test') {
  void refreshDbQueryLoggingFlag();
  dbQueryLoggingTimer = setInterval(() => {
    void refreshDbQueryLoggingFlag();
  }, 30_000);
  dbQueryLoggingTimer.unref();
}

// Exported so update endpoints can flip the flag immediately rather than
// waiting up to 30s for the next refresh.
export function setDbQueryLoggingEnabled(enabled: boolean): void {
  dbQueryLoggingEnabled = enabled;
}

/**
 * Sanitize Prisma query arguments to remove sensitive data
 */
function sanitizeArgs(args: unknown): unknown {
  if (!args) return args;

  // Clone to avoid mutating original
  const sanitized = JSON.parse(JSON.stringify(args)) as Record<string, unknown>;

  // Redact sensitive fields
  const sensitiveFields = [
    'password',
    'passwordHash',
    'password_hash',
    'token',
    'apiKey',
    'api_key',
    'openaiApiKey',
    'claudeApiKey',
    'globalOpenaiApiKey',
    'globalClaudeApiKey',
  ];

  function redactRecursive(obj: unknown): unknown {
    if (typeof obj !== 'object' || obj === null) return obj;

    if (Array.isArray(obj)) {
      return obj.map(redactRecursive);
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (sensitiveFields.includes(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactRecursive(value);
      }
    }
    return result;
  }

  return redactRecursive(sanitized);
}

/**
 * Prisma middleware for query logging
 * Logs all database queries when debug logging is enabled
 */
prisma.$use(async (params, next) => {
  const startTime = Date.now();

  try {
    const result = await next(params);

    // IMPORTANT: Exclude adminSettings queries from logging to prevent infinite recursion
    // (shouldLogDatabaseQueries() itself queries adminSettings)
    if (params.model !== 'AdminSettings') {
      if (dbQueryLoggingEnabled) {
        const duration = Date.now() - startTime;
        const resultCount = Array.isArray(result) ? result.length : result ? 1 : 0;

        dbLogger.debug({
          operation: 'database_query',
          message: `${params.model}.${params.action}`,
          context: {
            model: params.model,
            action: params.action,
            args: sanitizeArgs(params.args),
            resultCount,
          },
          performance: {
            duration,
          },
        });
      }
    }

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    // Always log errors, regardless of logging settings (except adminSettings to avoid recursion)
    if (params.model !== 'AdminSettings') {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Check if it's a database connection error (expected during startup/shutdown)
      const isConnectionError = 
        errorMessage.includes('Can\'t reach database server') ||
        errorMessage.includes('database system is shutting down') ||
        errorMessage.includes('Connection refused') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('P1001') || // Prisma connection error code
        errorMessage.includes('P1000') || // Prisma authentication error (can happen during connection)
        errorMessage.includes('P1017');   // Prisma server closed connection

      if (isConnectionError) {
        // Log connection errors as warning - these are expected during startup/shutdown
        dbLogger.warn({
          operation: 'database_connection_error',
          message: `${params.model}.${params.action} - database not available (this is normal during startup/shutdown)`,
          context: {
            model: params.model,
            action: params.action,
            args: sanitizeArgs(params.args),
          },
          performance: {
            duration,
          },
          error: {
            message: errorMessage,
          },
        });
      } else {
        // Log other errors as error
        dbLogger.error({
          operation: 'database_query_error',
          message: `${params.model}.${params.action} failed`,
          context: {
            model: params.model,
            action: params.action,
            args: sanitizeArgs(params.args),
          },
          performance: {
            duration,
          },
          error: {
            message: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
          },
        });
      }
    }

    throw error;
  }
});
