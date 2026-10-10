import { AsyncLocalStorage } from "node:async_hooks";

import { createPrismaClient } from "./prismaClient";
import logger, { dbLogger } from "./utils/logger";
import { toLoggable } from "./utils/logging/toLoggable";
import { getLoggingRuntimeFlags } from "./utils/logging/runtimeFlags";

const basePrisma = createPrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

/**
 * Write one query-log line, and never let it fail the query.
 *
 * With "log database queries" on, creating a user answered 500 and created
 * nobody (audit 2026-09-26): the argument clone here was
 * `JSON.parse(JSON.stringify(args))`, which throws on the BigInt of a passkey
 * counter, and the throw came out of the query. `toLoggable` cannot throw on
 * a value; this catch covers everything else (a logger that cannot write) and
 * says so through the root logger instead of failing the request it describes.
 */
function logQuerySafely(write: () => void, model: string | undefined, operation: string): void {
  try {
    write();
  } catch (error) {
    try {
      logger.warn({
        operation: "database_query_log_failed",
        context: { model, action: operation },
        error: { name: error instanceof Error ? error.name : typeof error },
      });
    } catch {
      // The logger itself is broken; there is nowhere left to say it.
    }
  }
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
 * A unique violation the caller is about to catch and handle is not a fault.
 *
 * Two paths rely on a unique index AS their dedupe: the idempotency key of a
 * create (`services/sync/clientRef.ts`, the loser of two concurrent POSTs) and
 * the push claim (`notifications/dispatcher.ts`, a phone already told). Both
 * catch P2002 by design, yet every one was logged as `database_query_error` —
 * an error log that cries wolf hides the unique violation that IS a bug.
 *
 * So the caller names the model whose P2002 it expects, around exactly the
 * call it catches. Inside that scope a P2002 on THAT model is logged at debug;
 * any other error, and a P2002 on any other model — or outside a scope — stays
 * at error level. Async-local, so it holds across the awaits of an interactive
 * transaction and never leaks into a concurrent request.
 */
const expectedUniqueConflict = new AsyncLocalStorage<string>();

export function expectingUniqueConflict<T>(model: string, run: () => Promise<T>): Promise<T> {
  // Awaited INSIDE the scope: a Prisma query is a lazy thenable that runs only
  // when awaited, so returning it unawaited would run it outside the scope.
  return expectedUniqueConflict.run(model, async () => await run());
}

/**
 * Query logging, as a client extension.
 *
 * This was `prisma.$use(...)` until Prisma 7 removed client middleware
 * outright. An extension is the documented replacement and is applied at
 * construction rather than bolted on afterwards, which is why the exported
 * singleton is built here at the foot of the file.
 *
 * Whether queries are logged is a synchronous flag (`runtimeFlags`), set by
 * `applyLoggingConfig()` at boot and on every settings change — this module
 * no longer asks the database about itself, which is what used to tie `db`
 * and `loggingConfig` into an import cycle.
 *
 * Query ARGUMENTS carry user data (names, notes, booking references), so they
 * are written only while the admin has query logging switched on; a failing
 * query is always logged, with its model and operation but without them.
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
      const verbose = getLoggingRuntimeFlags().databaseQueries;

      try {
        const result = await query(args);
        if (verbose) {
          logQuerySafely(
            () =>
              dbLogger.debug({
                operation: "database_query",
                message: `${model}.${operation}`,
                context: {
                  model,
                  action: operation,
                  args: toLoggable(args),
                  resultCount: Array.isArray(result) ? result.length : result ? 1 : 0,
                },
                performance: { duration: Date.now() - startTime },
              }),
            model,
            operation
          );
        }
        return result;
      } catch (error) {
        logQuerySafely(
          () => logQueryFailure(error, model, operation, verbose ? args : undefined, startTime),
          model,
          operation
        );
        throw error;
      }
    },
  },
});

const CONNECTION_ERROR_MARKERS = [
  "Can't reach database server",
  "database system is shutting down",
  "Connection refused",
  "ECONNREFUSED",
  "P1001", // Prisma: cannot reach the server
  "P1000", // Prisma: authentication failed (happens while connecting)
  "P1017", // Prisma: server closed the connection
];

function logQueryFailure(
  error: unknown,
  model: string | undefined,
  operation: string,
  args: unknown,
  startTime: number
): void {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  const code = (error as { code?: unknown })?.code;
  const entry = {
    context: {
      model,
      action: operation,
      ...(args !== undefined ? { args: toLoggable(args) } : {}),
    },
    performance: { duration: Date.now() - startTime },
  };

  if (code === "P2002" && model !== undefined && expectedUniqueConflict.getStore() === model) {
    dbLogger.debug({
      ...entry,
      operation: "database_expected_conflict",
      message: `${model}.${operation} - unique conflict, handled by the caller`,
      error: { code },
    });
    return;
  }

  // Connection errors are expected during startup and shutdown: a warning.
  if (CONNECTION_ERROR_MARKERS.some((marker) => errorMessage.includes(marker))) {
    dbLogger.warn({
      ...entry,
      operation: "database_connection_error",
      message: `${model}.${operation} - database not available`,
      error: { code: typeof code === "string" ? code : undefined, message: errorMessage },
    });
    return;
  }
  dbLogger.error({
    ...entry,
    operation: "database_query_error",
    message: `${model}.${operation} failed`,
    error: {
      name: error instanceof Error ? error.name : undefined,
      code: typeof code === "string" ? code : undefined,
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    },
  });
}

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
