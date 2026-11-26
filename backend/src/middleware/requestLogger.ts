import { Request, Response, NextFunction } from "express";
import { httpLogger, generateRequestId } from "../utils/logger";
import { getLoggingRuntimeFlags } from "../utils/logging/runtimeFlags";
import { requestPathForLog } from "../utils/logging/requestPath";
import { SLOW_REQUEST_MS, slowRequests } from "../services/runtime/slowLog";

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
  /** Set by `authenticate`. */
  userId?: string;
  requestId?: string;
}

const CLIENT_HEADER_MAX = 64;

/**
 * A client-chosen header as a log value: printable ASCII only (no control characters that could
 * forge a log line), cut at 64 characters. Absent or empty stays absent.
 */
export function headerForLog(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value
    .replace(/[^\x20-\x7e]/g, "?")
    .trim()
    .slice(0, CLIENT_HEADER_MAX);
  return clean || undefined;
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
    const duration = Date.now() - startTime;
    // A slow request is logged whatever the flag says (perf audit item 4),
    // keyed by the route pattern so ids do not make every line a new key.
    if (duration >= SLOW_REQUEST_MS) {
      slowRequests.note(`${req.method} ${req.baseUrl}${req.route?.path ?? ""}`, duration, {
        method: req.method,
        path: requestPathForLog(req),
        status: res.statusCode,
        userId: req.userId,
        requestId: req.requestId,
      });
    }
    if (!getLoggingRuntimeFlags().httpRequests) return;

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
        // travstats-mcp names itself and the tool, so a write can be traced to the assistant's call.
        clientName: headerForLog(req.get("x-travstats-client")),
        clientTool: headerForLog(req.get("x-travstats-tool")),
        // `authenticate` sets `req.userId`; `req.user` is never populated, which left every
        // request line without an owner (and out of a user's own diagnostic package).
        userId: req.userId ?? req.user?.id,
        isAdmin: req.user?.isAdmin,
        requestId: req.requestId,
        // Not of a raw body (the ingest paths before parsing): a Buffer's keys
        // are its byte indices.
        ...(req.method !== "GET" &&
          req.body &&
          !Buffer.isBuffer(req.body) && { bodyKeys: Object.keys(req.body) }),
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
