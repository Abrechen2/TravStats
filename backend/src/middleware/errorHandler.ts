import type { ApiErrorCode } from "./apiErrorCode";
import { Request, Response, NextFunction } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { Prisma } from "../prisma";
import logger from "../utils/logger";
import { requestPathForLog } from "../utils/logging/requestPath";
import { isDebugEnabled } from "../services/loggingConfig";

export interface ApiError extends Error {
  statusCode?: number;
}

export type { ApiErrorCode };

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
    // The path without its query string, and no username: both carried names,
    // search terms and booking references into error.log (audit 2026-09-26).
    context: {
      method: req.method,
      path: requestPathForLog(req),
      ip: req.ip,
      userAgent: req.get("user-agent"),
      userId: req.user?.id,
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
    // A time-model refusal is a 422 with its own code and field (ADR 0002),
    // not the generic 400 — a client has to tell "send {local, zone}" from
    // "this field is missing".
    const timeIssue = zodTimeIssue(err);
    if (timeIssue) {
      return res.status(422).json({
        error: "Time field refused",
        code: timeIssue.code,
        field: timeIssue.field,
      });
    }
    return res.status(400).json({
      error: "Validation error",
      code: "VALIDATION_FAILED" satisfies ApiErrorCode,
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
    // First, so none of the fixed keys below can be overwritten by it.
    ...(isAppError(err) && err.code && err.extra ? err.extra : {}),
    error: message,
    // A machine-readable cause, present only where the thrower named one.
    // `message` is English prose written for a log; a client that shows it to
    // a reader is showing them the wrong language (forgejo#88 finding 3 — the
    // login form printed "Invalid credentials" into a German page). The code
    // is what a client is meant to branch on.
    ...(isAppError(err) && err.code ? { code: err.code } : {}),
    // Which input the cause belongs to, so a form can put it beside that field.
    ...(isAppError(err) && err.field ? { field: err.field } : {}),
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

/**
 * The time-model codes a zod issue may carry as its message (ADR 0002). Lives
 * here, not in `shared/time/errors.ts`, because that module extends `AppError`
 * and importing it from this file would be a load-order cycle.
 */
export const ZOD_TIME_CODES: readonly ApiErrorCode[] = [
  "TIME_SHAPE_REQUIRED",
  "ZONE_UNKNOWN",
  "LOCAL_TIME_NONEXISTENT",
  "TZ_UNRESOLVED",
];

interface ZodIssueLike {
  message: string;
  path: PropertyKey[];
  errors?: ZodIssueLike[][];
}

/** The first time-model refusal inside a ZodError (descending into union branches), or null. */
export function zodTimeIssue(
  err: ZodError,
  issues: readonly ZodIssueLike[] = err.issues as unknown as ZodIssueLike[],
  prefix: PropertyKey[] = []
): { code: ApiErrorCode; field: string } | null {
  for (const issue of issues) {
    const path = [...prefix, ...issue.path];
    if ((ZOD_TIME_CODES as readonly string[]).includes(issue.message)) {
      return { code: issue.message as ApiErrorCode, field: path.map(String).join(".") };
    }
    for (const branch of issue.errors ?? []) {
      const nested = zodTimeIssue(err, branch, path);
      if (nested) return nested;
    }
  }
  return null;
}

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

  /**
   * The request field the cause belongs to (`arrivalLocal`,
   * `departureStation`), for a form that shows the message beside it.
   * Only meaningful with a `code` — the prose is still not for readers.
   */
  field?: string;

  /**
   * Facts a client needs to ask the user how to proceed — "4 photos are
   * filed at these stations; move them anyway?" (forgejo#139). Sent beside
   * `error`/`code`, which it can never overwrite. Only with a `code`.
   */
  extra?: Readonly<Record<string, string | number | boolean>>;

  constructor(
    message: string,
    statusCode: number = 500,
    code?: ApiErrorCode,
    field?: string,
    extra?: Readonly<Record<string, string | number | boolean>>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.field = field;
    this.extra = extra;
    this.name = "AppError";
  }
}
