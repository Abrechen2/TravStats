/**
 * The admin log area and the diagnostic export, as they travel over the wire.
 *
 * Mirrored byte for byte at `frontend/src/shared/logContract.ts`, and
 * `shared/__tests__/logContract.mirror.test.ts` fails when the two differ.
 * This file exists because the two sides used to describe these payloads
 * separately and had drifted: the cleanup toast read `filesDeleted` and
 * `spaceFreed` while the server sent `deletedCount` ("undefined files, NaN MB
 * freed"), and the stats card parsed filenames as dates ("—" for ever).
 *
 * Types and constants only — nothing here may import from either tree.
 */

/** The levels an admin can choose, most severe first. */
export const LOG_LEVELS = ["error", "warn", "info", "debug", "trace"] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

/**
 * Where the level that is actually in force came from.
 *
 * `environment`: `LOG_LEVEL` is set on the process and pins the level; the
 * stored setting is kept but does nothing until the variable is removed.
 * `settings`: the admin setting. `default`: neither could be read.
 */
export type LogLevelSource = "environment" | "settings" | "default";

export interface LoggingConfigResponse {
  /** The stored admin setting. */
  logLevel: LogLevelName;
  /** The level the running loggers use — differs from `logLevel` when pinned. */
  effectiveLogLevel: LogLevelName;
  logLevelSource: LogLevelSource;
  maxLogFileSize: number;
  maxLogFiles: number;
  logHttpRequests: boolean;
  logDatabaseQueries: boolean;
  logParserOperations: boolean;
  logRetentionDays: number;
}

export interface LogFileInfo {
  filename: string;
  /** The stream the file belongs to: `app`, `error`, `security`, … */
  category: string;
  size: number;
  /** ISO timestamps. */
  created: string;
  modified: string;
  /** A rotated, gzip-compressed file. Readable like any other. */
  compressed: boolean;
}

export interface LogFilesResponse {
  files: LogFileInfo[];
}

export interface LogStatsResponse {
  totalSize: number;
  fileCount: number;
  /** When the oldest / newest file was last written. Null without files. */
  oldestLogAt: string | null;
  newestLogAt: string | null;
  categoryBreakdown: Record<string, number>;
}

export interface LogCleanupResult {
  deletedCount: number;
  freedBytes: number;
  /** Files the sweep meant to delete and could not. Never silently zero. */
  failedCount: number;
  retentionDays: number;
}

/** One parsed line of a log file, as the viewer receives it. */
export interface LogFileEntry {
  timestamp?: string;
  time?: string;
  level?: string;
  category?: string;
  message?: string;
  operation?: string;
  [key: string]: unknown;
}

export interface LogReadResponse {
  filename: string;
  /** Newest first. */
  entries: LogFileEntry[];
  /** Entries in the file that match the filters. */
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/** Stable causes the log endpoints answer with, as `{ error, code }`. */
export const LOG_ERROR_CODES = [
  "LOG_FILE_INVALID_NAME",
  "LOG_FILE_NOT_FOUND",
  "LOG_FILE_UNREADABLE",
] as const;
export type LogErrorCode = (typeof LOG_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Diagnostic export (admin-only, attached to a public GitHub issue)
// ---------------------------------------------------------------------------

export const DIAGNOSTIC_BUNDLE_SCHEMA = "travstats-diagnostic/2";

/**
 * A section either carries its data or says that it failed and why. An empty
 * list where a section failed would read as "nothing happened".
 */
export type DiagnosticSection<T> =
  { status: "ok"; data: T } | { status: "failed"; errorCode: string };

/**
 * A log line reduced to what cannot carry personal data: no message text, no
 * values, no query strings — a time, a level, a category, the code-defined
 * event key, an error's code and class name, and where in the code it arose.
 */
export interface DiagnosticLogEvent {
  time: string;
  level: string;
  category: string | null;
  event: string | null;
  errorCode: string | null;
  errorName: string | null;
  /** `file.ts:123` — basename and line, nothing else. */
  stack: string[];
}

export interface DiagnosticLogFile {
  stream: string;
  rotated: boolean;
  sizeBytes: number;
  modifiedAt: string;
}

export interface DiagnosticLogsData {
  files: DiagnosticLogFile[];
  /** app.log, the last 24 h, newest kept when capped. */
  recent: DiagnosticLogEvent[];
  /** error.log, the last 7 days, newest kept when capped. */
  errors: DiagnosticLogEvent[];
  /** Files that could not be read — the lists above then have holes. */
  unreadableFiles: number;
  /** A cap was reached and older entries were left out. */
  truncated: boolean;
}

export interface DiagnosticBundle {
  schema: typeof DIAGNOSTIC_BUNDLE_SCHEMA;
  generatedAt: string;
  app: { version: string; buildVersion: string };
  runtime: { node: string; os: string; arch: string; uptimeSeconds: number };
  /** Accounts that have each domain switched on. */
  domains: DiagnosticSection<Record<string, number>>;
  /** Non-secret instance settings: booleans, numbers and closed enums only. */
  settings: DiagnosticSection<Record<string, boolean | number | string | null>>;
  counts: DiagnosticSection<Record<string, number>>;
  database: DiagnosticSection<{
    appliedMigrations: number;
    failedMigrations: number;
    latestMigration: string | null;
  }>;
  logs: DiagnosticSection<DiagnosticLogsData>;
}
