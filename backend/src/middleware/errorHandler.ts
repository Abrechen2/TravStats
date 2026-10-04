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
  /** An edit or delete named a base version (If-Match / baseVersion) the
   *  record has moved past — forgejo#141, `services/sync/versionPrecondition.ts`.
   *  The 409 carries the current record and the changed fields. */
  | "VERSION_CONFLICT"
  /** `GET /sync/changes` cannot continue this cursor (410): start a full read. */
  | "SYNC_RESYNC_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_DEACTIVATED"
  | "RATE_LIMITED"
  | "DB_UNAVAILABLE"
  | "DUPLICATE"
  /** Deleting a roadtrip or tour with no trip would delete its costs
   *  (forgejo#140): refused until the caller sends `deleteExpenses=true`. The
   *  body carries `expenseCount`. */
  | "SECTION_HAS_EXPENSES"
  /** A list filter named a loyalty card that is not this account's, or not
   *  of the list's kind (a hotel card on the flight list). The list says the
   *  programme is gone instead of showing an unfiltered or empty page. */
  | "LOYALTY_MEMBERSHIP_NOT_FOUND"
  /** A workshop template was activated before its preview had run — the
   *  parser page turns this into "run the preview", not a generic toast. */
  | "PREVIEW_REQUIRED"
  /** A training annotation whose offsets do not cut their own value out of
   *  the text being saved. The two used to be allowed to disagree, which
   *  corrupted every derivation built on it in silence. */
  | "ANNOTATION_TEXT_MISMATCH"
  /** The requested username is reserved by the system — see
   *  `schemas/auth.ts` `RESERVED_USERNAMES`. The register form turns this
   *  into its own sentence, in the reader's language. */
  | "USERNAME_RESERVED"
  /** A restore was asked for a part the archive does not carry — a file
   *  restore from an archive with no `uploads.tar.gz`, say. */
  | "RESTORE_ARCHIVE_INCOMPLETE"
  /** The archive carries the part but it cannot be read. Caught BEFORE the
   *  restore writes anything, because half a restore is neither state. */
  | "RESTORE_ARCHIVE_UNREADABLE"
  /** The archive's encrypted values belong to another instance key. The
   *  restore dialog turns this into the acknowledgement it needs. */
  | "RESTORE_ENCRYPTION_KEY_MISMATCH"
  /** An older archive's missing migration failed on its data (forgejo#157).
   *  The restore is one transaction, so nothing was changed. */
  | "RESTORE_MIGRATION_FAILED"
  /** Restored, yet the database lacks a migration record or a sync trigger
   *  this version expects (forgejo#157). Checked after commit. */
  | "RESTORE_SCHEMA_INCOMPLETE"
  /** The archive's database knows migrations this version does not: it was
   *  written by a newer version and cannot be migrated down (forgejo#157). */
  | "RESTORE_ARCHIVE_NEWER"
  /** The archive's database carries no `_prisma_migrations` at all, so its
   *  schema cannot be matched to any version (forgejo#157). */
  | "RESTORE_ARCHIVE_UNVERSIONED"
  /** The archive was taken while a migration had failed on its database
   *  (Prisma's P3009 state); its schema is no version's (forgejo#157). */
  | "RESTORE_ARCHIVE_FAILED_MIGRATION"
  /** A rail write body failed validation; `field` names the first field. */
  | "RAIL_INVALID_INPUT"
  /** A rail arrival instant before its departure — usually a night train
   *  whose arrival kept the departure's date. `field` is `arrivalLocal`. */
  | "RAIL_ARRIVAL_BEFORE_DEPARTURE"
  // Car rentals (spec 2026-10-01-rental-domain-design).
  | "RENTAL_INVALID_INPUT"
  | "RENTAL_INVALID_QUERY"
  | "RENTAL_NOT_FOUND"
  | "RENTAL_ROADTRIP_NOT_FOUND"
  | "RENTAL_RETURN_BEFORE_PICKUP"
  | "RENTAL_STATION_UNRESOLVED"
  | "RENTAL_GEOCODER_UNAVAILABLE"
  /** A cancellation or invoice for a booking this account does not hold — nothing was written. */
  | "RENTAL_UNKNOWN_BOOKING"
  /** An invoice's km beside a figure the user typed; the review shows both and asks. */
  | "RENTAL_INVOICE_KM_CONFLICT"
  /** A parse needed the configured LLM and could not reach it — "try later",
   *  not "broken". */
  | "LLM_UNREACHABLE"
  /** A parse failed for any other reason; the cause is in the server log. */
  | "PARSE_FAILED"
  /** The upload is not a readable PDF. */
  | "INVALID_PDF"
  /** The PDF has no usable text layer (a scan) — the image route reads it. */
  | "PDF_NO_TEXT"
  /** A boarding pass was read but carried no flight data. */
  | "NO_FLIGHT_DATA"
  /** An outside service the request depends on (OpenStreetMap, Open-Meteo)
   *  could not be asked: it timed out, refused more requests, or did not
   *  answer. Kept apart from "nothing found", which the UI used to say. */
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  /** A trip suggestion changed between being shown and being answered — an
   *  entry moved onto a trip, the trip or place was deleted. Reload, not retry. */
  | "TRIP_SUGGESTION_STALE"
  /** An accepted trip suggestion named members it does not hold, none at all,
   *  or an end before its start. */
  | "TRIP_SUGGESTION_SELECTION_INVALID"
  /** A request body failed its schema. Sent on every ZodError answer, so a
   *  form shows its own sentence instead of zod's JSON issue dump. */
  | "VALIDATION_FAILED"
  /** Time-zone re-resolution (ADR 0002 D2): `apply` named a dry run that
   *  does not exist or expired — run the dry run again. */
  | "DRY_RUN_NOT_FOUND"
  /** A re-resolution or the time-model backfill is already running. */
  | "RE_RESOLVE_RUNNING"
  /** Tour track upload: the file is over the size limit. */
  | "TRACK_FILE_TOO_LARGE"
  /** Tour track upload: not readable as GPX, TCX or FIT. */
  | "TRACK_FILE_UNREADABLE"
  /** Tour track upload: a recording without timestamps cannot be placed in time. */
  | "TRACK_NO_TIMESTAMPS"
  /** Tour track upload: this recording is already on the tour. */
  | "TRACK_ALREADY_IMPORTED"
  /** Flight recording (forgejo#193): the flight already has a recording under
   *  another upload id; resend with `replace: true` to swap it. */
  | "TRACK_ALREADY_RECORDED"
  /** Flight recording: the body is over its size limit (413). */
  | "TRACK_BODY_TOO_LARGE"
  /** Flight recording: its time span is nowhere near the flight's schedule —
   *  a recording filed under the wrong flight (422). */
  | "TRACK_OUTSIDE_FLIGHT"
  /** Observed takeoff/landing (forgejo#194): a time in the future (400). */
  | "OBSERVED_TIME_IN_FUTURE"
  /** Observed takeoff/landing: more than 12 h from the schedule (422). */
  | "OBSERVED_TIME_OUTSIDE_FLIGHT"
  /** Observed takeoff/landing at an airport that is not the flight's own —
   *  a diversion is the app's to report, never an arrival at the destination
   *  (422). `field` names the end. */
  | "OBSERVED_AIRPORT_MISMATCH"
  /** Dawarich pull: the section has no dated stops to derive a window from. */
  | "DAWARICH_NO_DATED_STOPS"
  /** Dawarich pull: the resolved window ends before it starts. */
  | "DAWARICH_WINDOW_INVALID"
  /** Dawarich pull: Dawarich answered, with no points in the window. */
  | "DAWARICH_WINDOW_EMPTY"
  /** Dawarich pull: a single point in the window — too few for a track. */
  | "DAWARICH_TOO_FEW_POINTS"
  /** This place has no zone the resolver can name (422, ADR 0002 D2) — no
   *  catalogue zone, no usable coordinates. A local time there cannot be
   *  interpreted, so it is refused rather than stored as UTC — see
   *  `shared/time/zoneOf.ts`. */
  | "TZ_UNRESOLVED"
  /** A wall clock typed by a person that its zone skips (spring-forward
   *  gap) — see `shared/time/instant.ts`. Machine sources are never refused. */
  | "LOCAL_TIME_NONEXISTENT"
  /** A zone name the server's tzdata does not know (`shared/time/errors.ts`). */
  | "ZONE_UNKNOWN"
  /** The zone lookup itself could not run (503) — distinct from
   *  `TZ_UNRESOLVED`, "this place has no zone" (422). */
  | "TIMEZONE_LOOKUP_UNAVAILABLE"
  /** A time sent in a shape the server may not interpret (ADR 0002 D3): an
   *  offset-less datetime string, or — from a browser session — a bare ISO-Z
   *  on a field that used to hold the place's wall clock as fake UTC (a web
   *  bundle from before the deploy). `field` names it; the page should reload. */
  | "TIME_SHAPE_REQUIRED"
  /** A tour's points are its trip's timeline stops — assigned at the trip, not replaced. */
  | "TOUR_POINTS_FROM_TRIP"
  /** A trip's timeline stop was sent as a route correction (via point). */
  | "VIA_POINT_ON_TIMELINE"
  /** A trip photo was linked to a stop that is not on its trip — neither on
   *  the trip's timeline nor a station of a roadtrip filed on it (forgejo#139).
   *  Also answered for a stop that does not exist, so a probe learns nothing
   *  about another account's stops. `field` is `stopId`. */
  | "STOP_NOT_ON_TRIP"
  /** A roadtrip whose stations hold photos of its trip cannot move to another
   *  trip or off it: the photos stay with the trip, and their station links
   *  would point across trips (forgejo#139). The body carries `stationPhotos`
   *  (how many) and `optIn: "detachStationPhotos"` — resend the PATCH with
   *  that set to take them off their stations and move anyway. */
  | "ROADTRIP_HAS_TRIP_PHOTOS"
  /** A roadtrip station with a night was sent as a route correction. */
  | "VIA_POINT_HAS_NIGHT"
  /** Backup / restore job failures — see `services/backup/backupFailure.ts`.
   *  A tool (pg_dump, psql, tar) is not installed where the server runs. */
  | "BACKUP_TOOL_MISSING"
  /** The backup volume ran out of space. */
  | "BACKUP_DISK_FULL"
  /** The server may not read or write the backup directory. */
  | "BACKUP_PERMISSION_DENIED"
  /** The database could not be reached by the dump/restore tool. */
  | "BACKUP_DB_UNREACHABLE"
  /** pg_dump is older than the database server it dumps. */
  | "BACKUP_TOOL_VERSION_MISMATCH"
  /** A backup failed for a cause not recognised above; detail in the log. */
  | "BACKUP_FAILED"
  /** A backup the server was stopped or restored in the middle of (stored on the row). */
  | "BACKUP_INTERRUPTED"
  /** A restore failed for a cause not recognised above; detail in the log. */
  | "RESTORE_FAILED"
  /** An admin has turned the language model off (`services/llm/llmGate.ts`).
   *  Kept apart from a plain 503 so the UI can say "switched off" rather than
   *  send the reader to check whether Ollama is running. */
  | "LLM_DISABLED"
  /** The provider is outside the local network and the admin has not opted
   *  in to sending documents there (`llmGate.assertLlmCloudConsent`). */
  | "LLM_CLOUD_NOT_CONSENTED"
  /** An AI provider base URL an admin typed is malformed / not http(s) /
   *  carries credentials, or is plain http to a host outside the local
   *  network (`llm/llmEndpoint.ts`). */
  | "LLM_BASE_URL_INVALID"
  | "LLM_BASE_URL_HTTPS_REQUIRED"
  /** The admin log area (`routes/admin/logging.ts`): a name that fails the
   *  traversal guard (400), a file that is not there (404), a file that could
   *  not be read or decompressed (500). */
  | "LOG_FILE_INVALID_NAME"
  | "LOG_FILE_NOT_FOUND"
  | "LOG_FILE_UNREADABLE"
  /** The diagnostic export built a bundle that failed its own allowlist
   *  schema and refused to send it (`services/diagnosticExport.ts`). */
  | "DIAGNOSTIC_EXPORT_REJECTED";

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
