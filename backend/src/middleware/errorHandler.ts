import { Request, Response, NextFunction } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { Prisma } from "../prisma";
import logger from "../utils/logger";
import { isDebugEnabled } from "../services/loggingConfig";

export interface ApiError extends Error {
  statusCode?: number;
}

/**
 * Every machine-readable cause an `/api` error body may carry in `code`.
 *
 * A closed union rather than `string`, so a typo at a throw site is a `tsc`
 * failure instead of a client branch that silently never matches — which is the
 * exact failure mode the codes were introduced to END. The frontend's
 * `lib/loginFailure.ts` compares against these spellings; nothing checks the
 * two lists against each other across the wire, so the compiler holding this
 * side is the half that can be held.
 *
 * Add a member here before using it, and keep it SCREAMING_SNAKE. Not in this
 * union: `DEMO_ACCOUNT_FORBIDDEN`, which by an older convention travels in the
 * `error` field rather than in `code`.
 */
export type ApiErrorCode =
  "INVALID_CREDENTIALS" | "ACCOUNT_DEACTIVATED" | "RATE_LIMITED" | "DB_UNAVAILABLE" | "DUPLICATE";

interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    isAdmin: boolean;
  };
  requestId?: string;
}

/**
 * Categorize error type for structured logging
 */
function categorizeError(err: ApiError | ZodError): string {
  if (err instanceof ZodError) return "validation_error";
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    if (err.statusCode === 401) return "auth_error";
    if (err.statusCode === 403) return "forbidden_error";
    if (err.statusCode === 404) return "not_found_error";
    return "client_error";
  }
  if (err.statusCode && err.statusCode >= 500) return "server_error";
  return "unknown_error";
}

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: "Not found" });
};

export const errorHandler = async (
  err:
    | ApiError
    | ZodError
    | Prisma.PrismaClientInitializationError
    | Prisma.PrismaClientKnownRequestError
    | SyntaxError,
  req: AuthRequest,
  res: Response,
  _next: NextFunction
) => {
  // Handle invalid JSON body — return generic 400 without internal parser details
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }

  // A multer rejection is a statement about the REQUEST — an unexpected file
  // field, too many files, a part that is too large — and multer attaches no
  // `statusCode`, so it fell through to 500 below. Measured 2026-09-18 on the
  // 2.7.0-beta.1 build: `POST /parse-email-file` with the wrong multipart
  // field answered `500 {"error":"Unexpected file field"}`. The message was
  // right and the status was not, which matters twice over — a client that
  // retries on 5xx retries a request that can never succeed, and the instance
  // logs a server fault it did not have (the same confusion #245 removed from
  // the log levels).
  //
  // Handled here rather than per route: three routes already wrap multer to
  // catch `LIMIT_FILE_SIZE` themselves (documents, profile picture, tour
  // tracks), and a fourth wrapper would be a fourth place to forget.
  // `LIMIT_FILE_SIZE` keeps its 413; every other multer code is a 400.
  if (err instanceof MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: err.message });
  }

  const debugEnabled = await isDebugEnabled().catch(() => false);
  const errorCategory = categorizeError(err as ApiError | ZodError);
  const statusCode = err instanceof ZodError ? 400 : (err as ApiError).statusCode || 500;

  // The level follows the status code, which was already being computed and
  // then ignored (#245). A 4xx describes a CLIENT mistake — a bad payload, a
  // missing session — not a fault of this server. Logging those at error level
  // meant the error log could not answer "is anything broken?": on production
  // its entire HTTP content was five 401s and two 400s, and it had never held
  // a single 5xx. It also let anyone who could reach the port grow the error
  // log indefinitely without credentials, writing their IP, user agent and
  // query string into it each time.
  //
  // An error with no status code stays at error level: an uncategorised throw
  // is a server fault until proven otherwise, and defaulting it to warn would
  // hide precisely what this log exists for.
  //
  // Everything else about the entry is unchanged — same category, same
  // operation, same context fields — so existing log tooling keeps working.
  //
  // The level is chosen by CALLING the chosen method on `logger`, never by
  // detaching one into a variable: pino's methods rely on `this`, so
  // `const f = logger.warn; f(...)` throws "Cannot read properties of
  // undefined (reading Symbol(pino.msgPrefix))" at runtime. A unit test that
  // mocks the logger with plain jest.fn()s cannot see that — see
  // errorHandler.logLevel.test.ts, which runs against the REAL logger.

  // Structured AI-friendly error logging
  const logEntry = {
    category: "error",
    operation: "error_handler",
    message: err.message,
    context: {
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
      ip: req.ip,
      userAgent: req.get("user-agent"),
      userId: req.user?.id,
      username: req.user?.username,
      requestId: req.requestId,
      errorCategory,
      statusCode,
    },
    error: {
      name: err.name,
      message: err.message,
      // Only include stack trace in debug mode or development
      stack: debugEnabled || process.env.NODE_ENV === "development" ? err.stack : undefined,
      // Include Zod validation details if applicable
      ...(err instanceof ZodError && {
        validationErrors: err.issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
          code: e.code,
        })),
      }),
    },
  };

  if (statusCode >= 500) {
    logger.error(logEntry);
  } else {
    logger.warn(logEntry);
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validation error",
      details: err.issues.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
  }

  // Prisma database connection errors → 503
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    (err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === "P1001" || err.code === "P1002" || err.code === "P1008"))
  ) {
    return res.status(503).json({
      error: "Datenbankverbindung fehlgeschlagen. Bitte versuche es später erneut.",
      code: "DB_UNAVAILABLE" satisfies ApiErrorCode,
    });
  }

  // Prisma unique-constraint violations → 409. Without this mapping a
  // duplicate iata/icao/unlocode create falls through to the generic branch
  // and leaks Prisma's raw multi-line error text to the client as a 500.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return res.status(409).json({
      error: "Ein Eintrag mit diesem Wert existiert bereits.",
      code: "DUPLICATE" satisfies ApiErrorCode,
    });
  }

  // Custom API errors. `statusCode` is the one computed at the top for the log
  // level — by this point the ZodError branch has already returned, so the two
  // expressions were identical and the second was a duplicate.
  const message = err.message || "Internal server error";

  res.status(statusCode).json({
    error: message,
    // A machine-readable cause, present only where the thrower named one.
    // `message` is English prose written for a log; a client that shows it to
    // a reader is showing them the wrong language (forgejo#88 finding 3 — the
    // login form printed "Invalid credentials" into a German page). The code
    // is what a client is meant to branch on.
    ...(isAppError(err) && err.code ? { code: err.code } : {}),
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export class AppError extends Error {
  statusCode: number;

  /**
   * Stable, machine-readable cause — see `ApiErrorCode`.
   *
   * Optional, and deliberately so: adding one to every throw site at once
   * would be a rename of the whole error surface. A route that has a client
   * needing to tell its failures apart names a code; the rest keep the prose
   * they already had. Typed as the closed union, so a misspelt member fails
   * `tsc` rather than shipping a branch no client can ever match.
   */
  code?: ApiErrorCode;

  constructor(message: string, statusCode: number = 500, code?: ApiErrorCode) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = "AppError";
  }
}
