import { createPrismaClient } from "./prismaClient";
import { dbLogger } from "./utils/logger";
import { shouldLogDatabaseQueries } from "./services/loggingConfig";

const basePrisma = createPrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

// Sync flag refreshed every 30s in the background. The previous middleware
// awaited shouldLogDatabaseQueries() on every query, which adds a microtask
// per call even when the underlying value comes from a cache. Reading a
// boolean is free; the refresh runs out-of-band.
let dbQueryLoggingEnabled = false;
let dbQueryLoggingTimer: NodeJS.Timeout | null = null;

async function refreshDbQueryLoggingFlag(): Promise<void> {
  try {
    dbQueryLoggingEnabled = await shouldLogDatabaseQueries();
  } catch {
    dbQueryLoggingEnabled = false;
  }
}

if (process.env.NODE_ENV !== "test") {
  void refreshDbQueryLoggingFlag();
  dbQueryLoggingTimer = setInterval(() => {
    void refreshDbQueryLoggingFlag();
  }, 30_000);
  dbQueryLoggingTimer.unref();
}

// Exported so update endpoints can flip the flag immediately rather than
// waiting up to 30s for the next refresh.
export function setDbQueryLoggingEnabled(enabled: boolean): void {
  dbQueryLoggingEnabled = enabled;
}

/**
 * Sanitize Prisma query arguments to remove sensitive data
 */
function sanitizeArgs(args: unknown): unknown {
  if (!args) return args;

  // Clone to avoid mutating original
  const sanitized = JSON.parse(JSON.stringify(args)) as Record<string, unknown>;

  // Redact sensitive fields
  const sensitiveFields = [
    "password",
    "passwordHash",
    "password_hash",
    "token",
    "apiKey",
    "api_key",
    "openaiApiKey",
    "claudeApiKey",
    "globalOpenaiApiKey",
    "globalClaudeApiKey",
  ];

  function redactRecursive(obj: unknown): unknown {
    if (typeof obj !== "object" || obj === null) return obj;

    if (Array.isArray(obj)) {
      return obj.map(redactRecursive);
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (sensitiveFields.includes(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactRecursive(value);
      }
    }
    return result;
  }

  return redactRecursive(sanitized);
}

/**
 * A query observer, and the reason this seam exists.
 *
 * Prisma 5 let a test install its own `prisma.$use` middleware on the shared
 * singleton and watch every query the routes and the services beneath them
 * made. Prisma 7 removed middleware, and `$extends` cannot replace it from the
 * outside: it returns a NEW client rather than mutating this one, so a test
 * that extended the singleton would watch a client nothing else uses.
 *
 * `statsPage.scanCount.test.ts` asserts a NUMBER of flight-table scans — one
 * instead of thirteen — and that assertion is the only thing standing between
 * `/stats/page` and quietly regressing to a fan-out. So the observability
 * comes back through the extension that is already here.
 */
export interface ObservedQuery {
  /** Undefined for a raw query, exactly as the old middleware reported it. */
  model: string | undefined;
  operation: string;
}

const queryObservers = new Set<(query: ObservedQuery) => void>();

/** Watch every query this client makes. Returns the function that stops it. */
export function observeQueries(observer: (query: ObservedQuery) => void): () => void {
  queryObservers.add(observer);
  return () => {
    queryObservers.delete(observer);
  };
}

/**
 * Query logging, as a client extension.
 *
 * This was `prisma.$use(...)` until Prisma 7 removed client middleware
 * outright. An extension is the documented replacement and is applied at
 * construction rather than bolted on afterwards, which is why the exported
 * singleton is built here at the foot of the file instead of at the top: the
 * extension body reads `dbQueryLoggingEnabled` and `sanitizeArgs`, and both
 * have to exist above it.
 *
 * `query.$allOperations` — not `query.$allModels.$allOperations` — because the
 * middleware it replaces also saw raw queries, where `model` is undefined.
 */
export const prisma = basePrisma.$extends({
  query: {
    async $allOperations({ model, operation, args, query }) {
      const startTime = Date.now();
      // Before the call, matching the old middleware: it recorded on the way
      // in, so a query that throws is still counted.
      for (const observer of queryObservers) observer({ model, operation });

      try {
        const result = await query(args);

        // IMPORTANT: Exclude adminSettings queries from logging to prevent infinite recursion
        // (shouldLogDatabaseQueries() itself queries adminSettings)
        if (model !== "AdminSettings") {
          if (dbQueryLoggingEnabled) {
            const duration = Date.now() - startTime;
            const resultCount = Array.isArray(result) ? result.length : result ? 1 : 0;

            dbLogger.debug({
              operation: "database_query",
              message: `${model}.${operation}`,
              context: {
                model,
                action: operation,
                args: sanitizeArgs(args),
                resultCount,
              },
              performance: {
                duration,
              },
            });
          }
        }

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        // Always log errors, regardless of logging settings (except adminSettings to avoid recursion)
        if (model !== "AdminSettings") {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";

          // Check if it's a database connection error (expected during startup/shutdown)
          const isConnectionError =
            errorMessage.includes("Can't reach database server") ||
            errorMessage.includes("database system is shutting down") ||
            errorMessage.includes("Connection refused") ||
            errorMessage.includes("ECONNREFUSED") ||
            errorMessage.includes("P1001") || // Prisma connection error code
            errorMessage.includes("P1000") || // Prisma authentication error (can happen during connection)
            errorMessage.includes("P1017"); // Prisma server closed connection

          if (isConnectionError) {
            // Log connection errors as warning - these are expected during startup/shutdown
            dbLogger.warn({
              operation: "database_connection_error",
              message: `${model}.${operation} - database not available (this is normal during startup/shutdown)`,
              context: {
                model,
                action: operation,
                args: sanitizeArgs(args),
              },
              performance: {
                duration,
              },
              error: {
                message: errorMessage,
              },
            });
          } else {
            // Log other errors as error
            dbLogger.error({
              operation: "database_query_error",
              message: `${model}.${operation} failed`,
              context: {
                model,
                action: operation,
                args: sanitizeArgs(args),
              },
              performance: {
                duration,
              },
              error: {
                message: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
              },
            });
          }
        }

        throw error;
      }
    },
  },
});

/**
 * The exported client's type, which is NOT `PrismaClient`: `$extends` returns a
 * distinct type, and a parameter annotated `PrismaClient` would reject the very
 * singleton every caller passes it.
 */
export type Db = typeof prisma;

/**
 * What `prisma.$transaction(async (tx) => …)` hands its callback.
 *
 * `Prisma.TransactionClient` describes a transaction on an UNEXTENDED client
 * and no longer matches: an extension changes the client's type, so a helper
 * annotated with the old name rejects the `tx` every caller actually has. The
 * excluded members are Prisma's own `ITXClientDenyList` — the operations that
 * make no sense inside a transaction — written out rather than imported from
 * `@prisma/client/runtime/client`, which the generated client marks internal.
 */
export type DbTransaction = Omit<
  Db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
