import { Request, Response, NextFunction } from 'express';
import { httpLogger, generateRequestId, enrichWithRequest } from '../utils/logger';
import { shouldLogHttpRequests } from '../services/loggingConfig';

// Cache for shouldLogHttpRequests result (5 min TTL)
let cachedShouldLog: boolean | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Request Logger Middleware
 *
 * Features:
 * - Assigns unique correlation ID to each request
 * - Logs request/response with timing
 * - Conditionally enabled based on admin settings
 * - AI-friendly structured format
 */

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    isAdmin: boolean;
  };
  requestId?: string;
}

/**
 * Request logger middleware
 * Attaches correlation ID and logs HTTP traffic when enabled
 */
export async function requestLoggerMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Assign unique request ID for correlation
  req.requestId = generateRequestId();

  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;

  // Capture response finish event
  res.on('finish', async () => {
    const duration = Date.now() - startTime;
    const endMemory = process.memoryUsage().heapUsed;
    const memoryDelta = endMemory - startMemory;

    // Only log if HTTP request logging is enabled (with caching)
    const now = Date.now();
    if (cachedShouldLog === null || (now - cacheTimestamp) > CACHE_TTL_MS) {
      cachedShouldLog = await shouldLogHttpRequests();
      cacheTimestamp = now;
    }
    const shouldLog = cachedShouldLog;

    if (shouldLog) {
      const context = {
        method: req.method,
        url: req.url,
        path: req.path,
        query: req.query,
        status: res.statusCode,
        statusClass: getStatusClass(res.statusCode),
        ip: req.ip,
        userAgent: req.get('user-agent'),
        userId: req.user?.id,
        username: req.user?.username,
        isAdmin: req.user?.isAdmin,
        requestId: req.requestId,
        // Optionally log request body for non-GET requests (excluding sensitive fields)
        ...(req.method !== 'GET' &&
          req.body && {
            bodyKeys: Object.keys(req.body),
          }),
      };

      const performance = {
        duration,
        memoryDelta: formatBytes(memoryDelta),
      };

      // Log at appropriate level based on status code
      const logLevel = getLogLevel(res.statusCode);

      httpLogger[logLevel]({
        operation: 'http_request',
        message: `${req.method} ${req.url} ${res.statusCode}`,
        context,
        performance,
      });
    }
  });

  next();
}

/**
 * Get status code class (2xx, 4xx, 5xx)
 */
function getStatusClass(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) return '2xx_success';
  if (statusCode >= 300 && statusCode < 400) return '3xx_redirect';
  if (statusCode >= 400 && statusCode < 500) return '4xx_client_error';
  if (statusCode >= 500) return '5xx_server_error';
  return 'unknown';
}

/**
 * Get appropriate log level based on status code
 */
function getLogLevel(statusCode: number): 'info' | 'warn' | 'error' {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
