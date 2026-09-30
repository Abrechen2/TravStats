import { Request, Response, NextFunction } from "express";
import { httpLogger, generateRequestId } from "../utils/logger";
import { getLoggingRuntimeFlags } from "../utils/logging/runtimeFlags";
import { requestPathForLog } from "../utils/logging/requestPath";

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
export function requestLoggerMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  // Assign unique request ID for correlation
  req.requestId = generateRequestId();

  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;

  // Whether to log is read when the response finishes, from the flag
  // `applyLoggingConfig()` sets — so switching HTTP logging on or off in the
  // admin UI takes effect on the next request. It used to sit behind a
  // five-minute cache of its own that no save invalidated.
  res.on("finish", () => {
    if (!getLoggingRuntimeFlags().httpRequests) return;

    const duration = Date.now() - startTime;
    const memoryDelta = process.memoryUsage().heapUsed - startMemory;
    // The full path (a router only sees its own tail) and never the query
    // string, which carries search terms, names and booking references.
    const path = requestPathForLog(req);

    httpLogger[getLogLevel(res.statusCode)]({
      operation: "http_request",
      message: `${req.method} ${path} ${res.statusCode}`,
      context: {
        method: req.method,
        path,
        status: res.statusCode,
        statusClass: getStatusClass(res.statusCode),
        ip: req.ip,
        userAgent: req.get("user-agent"),
        userId: req.user?.id,
        isAdmin: req.user?.isAdmin,
        requestId: req.requestId,
        ...(req.method !== "GET" && req.body && { bodyKeys: Object.keys(req.body) }),
      },
      performance: { duration, memoryDelta: formatBytes(memoryDelta) },
    });
  });

  next();
}

/**
 * Get status code class (2xx, 4xx, 5xx)
 */
function getStatusClass(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) return "2xx_success";
  if (statusCode >= 300 && statusCode < 400) return "3xx_redirect";
  if (statusCode >= 400 && statusCode < 500) return "4xx_client_error";
  if (statusCode >= 500) return "5xx_server_error";
  return "unknown";
}

/**
 * Get appropriate log level based on status code
 */
function getLogLevel(statusCode: number): "info" | "warn" | "error" {
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "warn";
  return "info";
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
