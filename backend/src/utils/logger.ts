import pino from 'pino';
import { createStream } from 'rotating-file-stream';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Request } from 'express';
import { getLoggingConfig } from '../services/loggingConfig';

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
function createRotatingStream(category: string, maxSizeMB: number = 10, maxFiles: number = 7) {
  return createStream(`${category}.log`, {
    size: `${maxSizeMB}M`,  // Rotate at configured size
    interval: '1d',  // Daily rotation
    path: LOG_DIR,
    compress: 'gzip',  // Compress rotated files
    maxFiles,  // Keep configured number of files
  });
}

// Cache for dynamic category streams
const categoryStreams: Map<string, pino.StreamEntry> = new Map();
let streamsInitialized = false;

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
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o755 });
    }
  } catch (mkdirError: any) {
    // If directory creation fails (e.g., permission denied), log warning but continue
    // The application will still work with console-only logging
    console.warn(`Could not create log directory ${LOG_DIR}:`, mkdirError?.message || mkdirError);
    console.warn('Logging to files disabled - using console only');
    // Don't throw - allow application to continue with console logging
  }

  // Only add file streams if directory exists and is writable
  if (fs.existsSync(LOG_DIR)) {
    try {
      // Test write permissions by creating a test file
      const testFile = require('path').join(LOG_DIR, '.write-test');
      try {
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
      } catch {
        // Directory exists but not writable - skip file streams
        throw new Error('Log directory is not writable');
      }

      // App log (all levels) - always enabled
      streams.push({
        level: 'trace',
        stream: createRotatingStream('app'),
      });

      // Error log (errors only) - always enabled
      streams.push({
        level: 'error',
        stream: createRotatingStream('error'),
      });
    } catch (streamError: any) {
      console.warn('Could not create log file streams:', streamError?.message || streamError);
      console.warn('Logging to files disabled - using console only');
    }
  }

  // Category-specific logs will be added dynamically via initializeCategoryStreams()
} catch (error) {
  console.warn('Could not create log file streams:', error);
}

// Create multi-stream logger
const logger = pino(pinoConfig, pino.multistream(streams));

export default logger;

/**
 * Initialize category-based log streams based on configuration
 * Called on startup and when config changes
 */
export async function initializeCategoryStreams(): Promise<void> {
  try {
    const config = await getLoggingConfig();
    const fs = require('fs');
    
    // Ensure log directory exists
    try {
      if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o755 });
      }
    } catch (mkdirError: any) {
      // If directory creation fails, skip category streams
      console.warn(`Could not create log directory ${LOG_DIR}:`, mkdirError?.message || mkdirError);
      return;
    }

    // Only proceed if directory exists and is writable
    if (!fs.existsSync(LOG_DIR)) {
      return;
    }

    // Clear existing category streams
    categoryStreams.clear();

    // Always create security log (security events should always be logged)
    categoryStreams.set('security', {
      level: 'warn', // Only warnings and errors for security
      stream: createRotatingStream('security', config.maxLogFileSize, config.maxLogFiles),
    });

    // Parser logs (if enabled)
    if (config.logParserOperations && config.debugLoggingEnabled) {
      // Main parser log (all parser operations)
      categoryStreams.set('parser', {
        level: 'debug',
        stream: createRotatingStream('parser', config.maxLogFileSize, config.maxLogFiles),
      });

      // Detailed parser category logs
      categoryStreams.set('parser-vision', {
        level: 'debug',
        stream: createRotatingStream('parser-vision', config.maxLogFileSize, config.maxLogFiles),
      });

      categoryStreams.set('parser-text', {
        level: 'debug',
        stream: createRotatingStream('parser-text', config.maxLogFileSize, config.maxLogFiles),
      });

      categoryStreams.set('parser-factory', {
        level: 'debug',
        stream: createRotatingStream('parser-factory', config.maxLogFileSize, config.maxLogFiles),
      });
    }

    // HTTP logs (if enabled)
    if (config.logHttpRequests && config.debugLoggingEnabled) {
      categoryStreams.set('http', {
        level: 'debug',
        stream: createRotatingStream('http', config.maxLogFileSize, config.maxLogFiles),
      });
    }

    // Database logs (if enabled)
    if (config.logDatabaseQueries && config.debugLoggingEnabled) {
      categoryStreams.set('database', {
        level: 'debug',
        stream: createRotatingStream('database', config.maxLogFileSize, config.maxLogFiles),
      });
    }

    streamsInitialized = true;
  } catch (error) {
    console.warn('Could not initialize category streams:', error);
    streamsInitialized = false;
  }
}

/**
 * Reinitialize category streams (called after config changes)
 * This will reset the logger cache so new loggers are created with updated streams
 */
export async function reinitializeCategoryStreams(): Promise<void> {
  // Close existing streams before creating new ones
  for (const streamEntry of categoryStreams.values()) {
    if (streamEntry.stream && typeof (streamEntry.stream as any).end === 'function') {
      (streamEntry.stream as any).end();
    }
  }
  
  // Reset logger cache
  resetCategoryLoggerCache();
  
  // Initialize new streams
  await initializeCategoryStreams();
}

/**
 * Create streams array for a category logger
 * Includes console, category-specific file stream (if enabled), and base app/error streams
 */
function createCategoryStreams(category: string): pino.StreamEntry[] {
  const categoryStreamsArray: pino.StreamEntry[] = [
    // Always include console
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

  // Add category-specific file stream if available
  const categoryStream = categoryStreams.get(category);
  if (categoryStream) {
    categoryStreamsArray.push(categoryStream);
  }

  // Also add to main app.log and error.log (always available)
  try {
    const fs = require('fs');
    if (fs.existsSync(LOG_DIR)) {
      categoryStreamsArray.push(
        { level: 'trace', stream: createRotatingStream('app') },
        { level: 'error', stream: createRotatingStream('error') }
      );
    }
  } catch (error) {
    // Ignore errors for base streams
  }

  return categoryStreamsArray;
}

/**
 * Category logger cache - stores created loggers
 */
const categoryLoggerCache = new Map<string, pino.Logger>();

/**
 * Get or create a category logger
 * Loggers are created lazily and cached
 */
function getCategoryLogger(category: string): pino.Logger {
  if (!categoryLoggerCache.has(category)) {
    const streams = createCategoryStreams(category);
    const categoryLogger = pino(pinoConfig, pino.multistream(streams));
    categoryLoggerCache.set(category, categoryLogger.child({ category }));
  }
  return categoryLoggerCache.get(category)!;
}

/**
 * Reset category logger cache (called after stream reinitialization)
 */
function resetCategoryLoggerCache(): void {
  categoryLoggerCache.clear();
}

/**
 * Category-specific loggers
 * These provide structured logging with automatic category tagging
 * and dedicated file streams when enabled in config
 * 
 * Loggers are created lazily on first use and cached.
 * After reinitializeCategoryStreams(), the cache is cleared and new loggers
 * will be created with updated streams on next use.
 * 
 * These loggers use the base logger but will also write to category-specific
 * files when streams are initialized via initializeCategoryStreams().
 */
export const httpLogger = getCategoryLogger('http');
export const dbLogger = getCategoryLogger('database');
export const parserLogger = getCategoryLogger('parser');
export const parserVisionLogger = getCategoryLogger('parser-vision');
export const parserTextLogger = getCategoryLogger('parser-text');
export const parserFactoryLogger = getCategoryLogger('parser-factory');
export const securityLogger = getCategoryLogger('security');
export const systemLogger = getCategoryLogger('system');

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
