import pino from 'pino';
import { createStream } from 'rotating-file-stream';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Request } from 'express';

/**
 * AI-Optimized Structured Logger with Rolling File Support
 *
 * Features:
 * - Multi-transport (console + rotating files)
 * - Category-based logging (http, database, parser, security)
 * - Performance tracking with PerformanceTracker class
 * - Request correlation IDs
 * - Sensitive data redaction
 * - AI-friendly structured JSON format
 */

// Log directory path
const LOG_DIR = path.join(process.cwd(), '..', 'data', 'logs');

// Create rotating file stream
function createRotatingStream(category: string) {
  return createStream(`${category}.log`, {
    size: '10M',  // Rotate at 10MB (will be overridden by config)
    interval: '1d',  // Daily rotation
    path: LOG_DIR,
    compress: 'gzip',  // Compress rotated files
    maxFiles: 7,  // Keep 7 files (will be overridden by config)
  });
}

// Pino configuration for AI-optimized output
const pinoConfig: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),

  formatters: {
    level: (label) => ({ level: label }),

    // Custom formatter for AI-friendly structure
    log: (obj: any) => {
      // Restructure for AI consumption
      const { msg, time, level, category, context, performance, error, requestId, ...rest } = obj;

      const result: any = {
        timestamp: time ? new Date(time as number).toISOString() : new Date().toISOString(),
        level,
        category: category || 'general',
        message: msg,
      };

      if (context) result.context = context;
      if (performance) result.performance = performance;
      if (requestId) result.requestId = requestId;
      if (error) result.error = error;

      return { ...result, ...rest };
    },
  },

  timestamp: pino.stdTimeFunctions.isoTime,

  // Redact sensitive fields
  redact: {
    paths: [
      'password',
      'passwordHash',
      'token',
      'auth_token',
      'authorization',
      'cookie',
      'JWT_SECRET',
      'IMPORT_SECRET',
      'AIRLABS_API_KEY',
      'OPENSKY_CLIENT_SECRET',
      'apiKey',
      'api_key',
      'openaiApiKey',
      'claudeApiKey',
      'globalOpenaiApiKey',
      'globalClaudeApiKey',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.apiKey',
      'context.apiKey',
      'args.data.passwordHash',
      'args.data.openaiApiKey',
      'args.data.claudeApiKey',
    ],
    remove: true,
  },
};

// Create streams array
const streams: pino.StreamEntry[] = [
  // Console stream (always enabled)
  {
    level: 'trace',
    stream: process.env.NODE_ENV === 'development'
      ? pino.transport({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        })
      : process.stdout,
  },
];

// Add file streams (always enabled for error logging, debug mode adds more)
try {
  // Ensure log directory exists
  const fs = require('fs');
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o755 });
  }

  // App log (all levels)
  streams.push({
    level: 'trace',
    stream: createRotatingStream('app'),
  });

  // Error log (errors only)
  streams.push({
    level: 'error',
    stream: createRotatingStream('error'),
  });

  // Debug-specific logs will be added dynamically
} catch (error) {
  console.warn('Could not create log file streams:', error);
}

// Create multi-stream logger
const logger = pino(pinoConfig, pino.multistream(streams));

export default logger;

/**
 * Category-specific loggers
 * These provide structured logging with automatic category tagging
 */
export const httpLogger = logger.child({ category: 'http' });
export const dbLogger = logger.child({ category: 'database' });
export const parserLogger = logger.child({ category: 'parser' });
export const securityLogger = logger.child({ category: 'security' });
export const systemLogger = logger.child({ category: 'system' });

/**
 * Performance Tracker for measuring operation duration
 *
 * Usage:
 * const tracker = new PerformanceTracker('email_parse', { userId, provider: 'ollama' });
 * try {
 *   const result = await parseEmail(...);
 *   tracker.finish({ success: true, flightCount: result.length });
 * } catch (error) {
 *   tracker.finish({ success: false, error: error.message });
 * }
 */
export class PerformanceTracker {
  private startTime: number;
  private startMemory: number;
  private operation: string;
  private context: Record<string, any>;
  private loggerInstance: pino.Logger;

  constructor(operation: string, context?: Record<string, any>, loggerInstance: pino.Logger = logger) {
    this.operation = operation;
    this.context = context || {};
    this.startTime = Date.now();
    this.startMemory = process.memoryUsage().heapUsed;
    this.loggerInstance = loggerInstance;

    // Log operation start
    this.loggerInstance.debug({
      operation: `${operation}_start`,
      context: this.context,
      performance: {
        startTime: new Date(this.startTime).toISOString(),
        memoryUsed: this.formatBytes(this.startMemory),
      },
    });
  }

  /**
   * Finish tracking and log results
   */
  finish(metadata?: Record<string, any>): void {
    const duration = Date.now() - this.startTime;
    const endMemory = process.memoryUsage().heapUsed;
    const memoryDelta = endMemory - this.startMemory;

    this.loggerInstance.debug({
      operation: `${this.operation}_complete`,
      context: this.context,
      performance: {
        duration,
        memoryUsed: this.formatBytes(endMemory),
        memoryDelta: this.formatBytes(memoryDelta),
      },
      ...(metadata && { metadata }),
    });
  }

  private formatBytes(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
}

/**
 * Generate unique request correlation ID
 */
export function generateRequestId(): string {
  return `req-${uuidv4().substring(0, 8)}`;
}

/**
 * Extract request context for logging
 */
export function enrichWithRequest(req: Request): Record<string, any> {
  return {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: (req as any).user?.id,
    requestId: (req as any).requestId,
  };
}

/**
 * Log HTTP request/response (legacy helper, prefer requestLogger middleware)
 */
export function logRequest(req: any, res: any, duration: number) {
  httpLogger.info({
    operation: 'http_request',
    context: {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.id,
    },
    performance: {
      duration,
    },
  });
}

/**
 * Log database query (legacy helper, prefer Prisma middleware)
 */
export function logQuery(query: string, duration: number) {
  dbLogger.debug({
    operation: 'database_query',
    context: {
      query,
    },
    performance: {
      duration,
    },
  });
}

/**
 * Log external API call
 */
export function logApiCall(service: string, endpoint: string, duration: number, success: boolean) {
  logger.info({
    category: 'api_call',
    operation: 'external_api_call',
    context: {
      service,
      endpoint,
      success,
    },
    performance: {
      duration,
    },
  });
}

/**
 * Log achievement unlock
 */
export function logAchievement(userId: string, achievementId: string, achievementName: string) {
  logger.info({
    category: 'achievement',
    operation: 'achievement_unlock',
    context: {
      userId,
      achievementId,
      achievementName,
    },
  });
}

/**
 * Log security event
 */
export function logSecurityEvent(
  type: 'rate_limit' | 'auth_failure' | 'invalid_token' | 'admin_action' | 'suspicious_activity',
  ip: string,
  details?: any
) {
  securityLogger.warn({
    operation: 'security_event',
    context: {
      eventType: type,
      ip,
      ...details,
    },
  });
}
