import pino from "pino";
import { v4 as uuidv4 } from "uuid";
import { LogLevelName } from "../shared/logContract";
import { closeFileStream, getFileStream } from "./logging/fileStreams";
import { resolveEffectiveLogLevel } from "./logging/levelPolicy";

/**
 * Structured JSON logging: one root logger plus stable category loggers.
 *
 * Every line goes to the console and to `app.log`; error and above also to
 * `error.log`. A category logger additionally writes its own file
 * (`security.log`, `http.log`, …) once that file is switched on by
 * `setCategoryFileEnabled` — which `applyLoggingConfig()` does at boot and on
 * every settings change.
 *
 * The category loggers are created ONCE, here, and never replaced. Until
 * 2026-09-26 they were bound at import to a stream set built before the
 * category streams existed, and "re-initialising" built new loggers nobody
 * held a reference to — so `security.log`, `http.log` and `database.log`
 * stayed at 0 bytes on every instance. Now the destination of each logger is a
 * multistream that is updated in place, so the exported constant is the
 * logger that writes the file.
 *
 * The level is applied the same way: `setLoggerLevel` sets the root AND every
 * category logger, because pino does not propagate a level change.
 */

const consoleDestination: pino.DestinationStream =
  process.env.NODE_ENV === "development"
    ? pino.transport({
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss Z", ignore: "pid,hostname" },
      })
    : process.stdout;

const initialLevel = resolveEffectiveLogLevel(null).level;

const pinoConfig: pino.LoggerOptions = {
  level: initialLevel,

  // No hostname, no pid: neither helps read a log, and both identified the
  // machine in every exported bundle.
  base: null,

  // Serializers turn Error instances into plain, enumerable objects. Without
  // this, `logger.error({ error }, ...)` logged `"error":{}` because an Error's
  // `message`/`stack` are non-enumerable. Both `err` and the project-wide
  // `error` key are mapped; non-Error values pass through untouched.
  serializers: {
    err: pino.stdSerializers.err,
    error: (value: unknown) => (value instanceof Error ? pino.stdSerializers.err(value) : value),
  },

  formatters: {
    level: (label) => ({ level: label }),
    // `category` is written exactly once. It used to come from a child
    // binding AND from this formatter ("general"), so every category line
    // carried the key twice and a JSON reader kept the second — "general" —
    // which is why filtering the log by category found nothing.
    log: (obj: Record<string, unknown>) => {
      const { msg, category, ...rest } = obj;
      return {
        category: typeof category === "string" && category ? category : "general",
        ...(msg !== undefined ? { message: msg } : {}),
        ...rest,
      };
    },
  },

  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,

  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "auth_token",
      "authorization",
      "cookie",
      "JWT_SECRET",
      "IMPORT_SECRET",
      "AIRLABS_API_KEY",
      "OPENSKY_CLIENT_SECRET",
      "apiKey",
      "api_key",
      "openaiApiKey",
      "claudeApiKey",
      "globalOpenaiApiKey",
      "globalClaudeApiKey",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.apiKey",
      "context.apiKey",
      "args.data.passwordHash",
      "args.data.openaiApiKey",
      "args.data.claudeApiKey",
    ],
    remove: true,
  },
};

/** Console, app.log and error.log — the destinations every logger shares. */
function baseStreams(): pino.StreamEntry[] {
  const entries: pino.StreamEntry[] = [{ level: "trace", stream: consoleDestination }];
  const app = getFileStream("app");
  if (app) entries.push({ level: "trace", stream: app });
  const error = getFileStream("error");
  if (error) entries.push({ level: "error", stream: error });
  return entries;
}

const logger = pino(pinoConfig, pino.multistream(baseStreams()));

export default logger;

/**
 * The category files and the lowest level each accepts. Security is always
 * on (see `applyLoggingConfig`); the rest follow the admin's switches.
 */
export const CATEGORY_FILES = {
  http: "debug",
  database: "debug",
  parser: "debug",
  "parser-vision": "debug",
  "parser-text": "debug",
  "parser-factory": "debug",
  security: "warn",
} as const satisfies Record<string, pino.Level>;

export type FileCategory = keyof typeof CATEGORY_FILES;

/**
 * pino's multistream at runtime also has `remove(id)` and the `lastId` that
 * `add` assigned — both used here to swap a category file in place — but its
 * type declarations omit them. `categoryLogger.test.ts` exercises both against
 * the real implementation, so a pino upgrade that drops them fails there.
 */
type MutableMultiStream = pino.MultiStreamRes & {
  lastId: number;
  remove(id: number): pino.MultiStreamRes;
};

interface CategoryLogger {
  logger: pino.Logger;
  destination: MutableMultiStream;
  /** The id of the attached category-file entry, when there is one. */
  fileEntryId: number | null;
}

const categoryLoggers = new Map<string, CategoryLogger>();

function createCategoryLogger(category: string): pino.Logger {
  const destination = pino.multistream(baseStreams()) as MutableMultiStream;
  const categoryLogger = pino({ ...pinoConfig, mixin: () => ({ category }) }, destination);
  categoryLoggers.set(category, { logger: categoryLogger, destination, fileEntryId: null });
  return categoryLogger;
}

export const httpLogger = createCategoryLogger("http");
export const dbLogger = createCategoryLogger("database");
export const parserLogger = createCategoryLogger("parser");
export const parserVisionLogger = createCategoryLogger("parser-vision");
export const parserTextLogger = createCategoryLogger("parser-text");
export const parserFactoryLogger = createCategoryLogger("parser-factory");
export const securityLogger = createCategoryLogger("security");
export const systemLogger = createCategoryLogger("system");

/** Apply one level to the root logger and every category logger. */
export function setLoggerLevel(level: LogLevelName): void {
  logger.level = level;
  for (const { logger: categoryLogger } of categoryLoggers.values()) {
    categoryLogger.level = level;
  }
}

/**
 * Attach or detach a category's own file. Idempotent. Returns whether the
 * file is attached afterwards — false when it was asked for and the directory
 * cannot be written, which the caller reports instead of assuming success.
 */
export function setCategoryFileEnabled(category: FileCategory, enabled: boolean): boolean {
  const entry = categoryLoggers.get(category);
  if (!entry) return false;

  if (enabled) {
    if (entry.fileEntryId !== null) return true;
    const stream = getFileStream(category);
    if (!stream) return false;
    entry.destination.add({ level: CATEGORY_FILES[category], stream });
    entry.fileEntryId = entry.destination.lastId;
    return true;
  }

  if (entry.fileEntryId !== null) {
    entry.destination.remove(entry.fileEntryId);
    entry.fileEntryId = null;
    closeFileStream(category);
  }
  return false;
}

/** Categories whose own file is attached right now. */
export function attachedCategoryFiles(): string[] {
  return [...categoryLoggers.entries()]
    .filter(([, entry]) => entry.fileEntryId !== null)
    .map(([category]) => category);
}

/** Generate a request correlation id. */
export function generateRequestId(): string {
  return `req-${uuidv4().substring(0, 8)}`;
}
