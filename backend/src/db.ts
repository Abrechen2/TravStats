import { PrismaClient } from '@prisma/client';
import { dbLogger } from './utils/logger';
import { shouldLogDatabaseQueries } from './services/loggingConfig';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

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
      // Only log if database query logging is enabled
      const shouldLog = await shouldLogDatabaseQueries().catch(() => false);

      if (shouldLog) {
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
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
    }

    throw error;
  }
});
