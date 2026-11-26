import { AsyncLocalStorage } from "node:async_hooks";

import {
  applyRecordedOnly,
  entryFilterActive,
  placeVisitHiddenActive,
  runUnfiltered,
} from "./services/provenance/recordedOnly";
import {
  demoteHiddenOnlyVisited,
  demoteNestedPlaces,
  ensureIdSelected,
  isPlaceRead,
  planNestedPlaces,
  type VisitFact,
} from "./services/purpose/placeVisited";
import { inheritPurposeOnCreate } from "./services/purpose/tripInheritance";
import { createPrismaClient } from "./prismaClient";
import { sessionTimeoutsFromEnv } from "./services/db/sessionTimeouts";
import {
  captureWrite,
  configureChangeLedger,
  captureMcpCreate,
  isCapturedWrite,
  isMcpCreate,
  isLedgerInternal,
  runLedgerTransaction,
  runNestedLedgerTransaction,
} from "./services/changeLedger/capture";
import logger, { dbLogger } from "./utils/logger";
import { toLoggable } from "./utils/logging/toLoggable";
import { getLoggingRuntimeFlags } from "./utils/logging/runtimeFlags";

const basePrisma = createPrismaClient({
  sessionTimeouts: sessionTimeoutsFromEnv(),
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});
// The change ledger reads its snapshots and writes its rows on the unextended
// client, so its own queries never re-enter the hook below.
configureChangeLedger(basePrisma);

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

/**
 * A completed write, for the one subscriber that must learn about every
 * creator and editor of an entry without each of them calling it (the automatic
 * photo links, `services/photoLinking/entryPhotoTriggers.ts`). It runs inside
 * the query, possibly before an enclosing transaction commits, so a subscriber
 * defers its work; it never throws into the write.
 */
export interface WriteEvent {
  model: string | undefined;
  operation: string;
  args: unknown;
  result: unknown;
}
/** The reads the write listeners skip (the old filter, kept as it was). */
const READ_OPERATIONS: ReadonlySet<string> = new Set(["findMany", "findFirst"]);

let writeObserver: ((event: WriteEvent) => void) | null = null;

/**
 * More subscribers than the one slot above: they are told after it, each isolated from the
 * others' failures. Returns the function that removes it.
 */
const extraWriteObservers = new Set<(event: WriteEvent) => void>();
export function addWriteObserver(observer: (event: WriteEvent) => void): () => void {
  extraWriteObservers.add(observer);
  return () => extraWriteObservers.delete(observer);
}

export function setWriteObserver(observer: ((event: WriteEvent) => void) | null): void {
  writeObserver = observer;
}

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
 * A bounded wait the caller is about to retry is not a fault either: a
 * TravTrack import batch sets `lock_timeout` and tries again later when the
 * account's lock is busy (`imports/fileImport.ts`). Inside this scope a lock or
 * statement timeout is logged at debug — the caller logs one warning per retry
 * and leaves the scope for its last try, whose failure stays at error level.
 */
const expectedBusyWait = new AsyncLocalStorage<true>();

export function expectingBusyWait<T>(run: () => Promise<T>): Promise<T> {
  return expectedBusyWait.run(true, async () => await run());
}

/** Postgres's own words for a wait that gave up: lock timeout (55P03), statement timeout (57014). */
const BUSY_WAIT = /\b55P03\b|\b57014\b|lock timeout|statement timeout/i;

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
const queried = basePrisma.$extends({
  query: {
    async $allOperations(params) {
      const { model, operation, args: askedArgs, query } = params;
      // The change ledger's own snapshot or insert through a transaction
      // client: not the caller's query, so neither observed, logged nor captured.
      if (isLedgerInternal()) return query(askedArgs);
      // "Nur belegte": inside a recorded-only request every read of an entry model leaves out
      // what was typed in from memory (services/provenance/recordedOnly.ts).
      // A new entry inside a trip starts with the trip's purpose (services/purpose/tripInheritance.ts).
      // A batch `$transaction([...])` runs this hook for each query while the batch is still being
      // built, before it holds a connection: the lookup reads the committed trip (resolved before the
      // batch, never inside it). A trip created in the same batch is not there yet, so its entries
      // keep an unknown purpose (purpose.txInheritance.test.ts, purposeHook.reads.test.ts).
      const inherited = await inheritPurposeOnCreate(model, operation, askedArgs, async (id) => {
        // Inside an interactive transaction the lookup runs on THAT transaction: a trip created a
        // statement earlier is only visible there, and a second pool connection would wait for
        // the one the transaction holds (a deadlock at connection_limit=1).
        const reader = openTransaction.getStore() ?? basePrisma;
        const trip = await runUnfiltered(
          async () => await reader.trip.findFirst({ where: { id }, select: { category: true } })
        );
        return trip?.category ?? null;
      });
      const scoped = applyRecordedOnly(
        model,
        operation,
        inherited,
        placeVisitHiddenActive() ? (await import("./shared/time/clock")).now() : undefined
      );
      // A place that is "visited" only through a hidden business visit stops counting as visited.
      const filter = entryFilterActive();
      const hiddenPlaceVisits = filter.hidden.PlaceVisit ?? [];
      const hiddenVisitPurposes = isPlaceRead(model, operation) ? hiddenPlaceVisits : [];
      const ensured =
        hiddenVisitPurposes.length > 0 ? ensureIdSelected(scoped) : { args: scoped, added: false };
      const addedId = ensured.added;
      // The same correction for Place rows reached through an include (a list entry's `place`).
      const nested =
        hiddenPlaceVisits.length > 0
          ? await planNestedPlaces(model, operation, ensured.args)
          : { args: ensured.args, tree: null };
      const args = nested.args;
      // Every visit of the places, past the purpose filter (a hidden visit must be seen to be
      // counted as hidden), but not past "Nur belegte": a remembered visit the user hides that way
      // is no visible visit and cannot keep a place visited.
      const loadVisits = async (ids: string[]): Promise<VisitFact[]> => {
        const visits = await runUnfiltered(
          async () =>
            await (openTransaction.getStore() ?? basePrisma).placeVisit.findMany({
              where: { placeId: { in: ids } },
              select: {
                placeId: true,
                purpose: true,
                visitedAt: true,
                visitedAtUtc: true,
                provenance: true,
              },
            })
        );
        return filter.recorded ? visits.filter((v) => v.provenance !== "remembered") : visits;
      };
      const startTime = Date.now();
      // Before the call, matching the old middleware: it recorded on the way
      // in, so a query that throws is still counted.
      for (const observer of queryObservers) observer({ model, operation });
      const verbose = getLoggingRuntimeFlags().databaseQueries;

      try {
        // Edits of travel entries keep their history (the change ledger, spec
        // 2026-11-22-change-history); everything else runs as it always did.
        const raw = isCapturedWrite(model, operation)
          ? await captureWrite(
              model as string,
              operation,
              args,
              () => query(args),
              // Set inside a `$transaction` (interactive or batch); Prisma does not type it.
              (params as { __internalParams?: { transaction?: unknown } }).__internalParams
                ?.transaction != null
            )
          : isMcpCreate(model, operation)
            ? await captureMcpCreate(
                model as string,
                () => query(args),
                (params as { __internalParams?: { transaction?: unknown } }).__internalParams
                  ?.transaction != null
              )
            : await query(args);
        const topLevel =
          hiddenVisitPurposes.length > 0
            ? await demoteHiddenOnlyVisited(
                raw,
                hiddenVisitPurposes,
                loadVisits,
                addedId,
                (await import("./shared/time/clock")).now()
              )
            : raw;
        const result = nested.tree
          ? await demoteNestedPlaces(
              topLevel,
              nested.tree,
              hiddenPlaceVisits,
              loadVisits,
              (await import("./shared/time/clock")).now()
            )
          : topLevel;
        if (!READ_OPERATIONS.has(operation)) {
          for (const observer of [
            ...(writeObserver ? [writeObserver] : []),
            ...extraWriteObservers,
          ]) {
            try {
              observer({ model, operation, args, result });
            } catch (observerError) {
              dbLogger.error({ message: "write_observer_failed", error: observerError });
            }
          }
        }
        if (verbose) {
          logQuerySafely(
            () =>
              dbLogger.debug({
                operation: "database_query",
                message: `${model}.${operation}`,
                context: {
                  model,
                  action: operation,
                  args: model?.startsWith("TravelPlan")
                    ? "[redacted planning data]"
                    : toLoggable(args),
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
          () =>
            logQueryFailure(
              error,
              model,
              operation,
              verbose && !model?.startsWith("TravelPlan") ? args : undefined,
              startTime
            ),
          model,
          operation
        );
        throw error;
      }
    },
  },
});

/**
 * The interactive transaction the current async flow runs in, for the hook's own lookups (the
 * purpose inheritance reads the trip's category). Set by the `$transaction` wrapper below.
 */
type TripReader = {
  trip: {
    findFirst(args: {
      where: { id: string };
      select: { category: true };
    }): Promise<{ category: string | null } | null>;
  };
  placeVisit: {
    findMany(args: {
      where: { placeId: { in: string[] } };
      select: {
        placeId: true;
        purpose: true;
        visitedAt: true;
        visitedAtUtc: true;
        provenance: true;
      };
    }): Promise<
      Array<{
        placeId: string;
        purpose: string | null;
        visitedAt: Date | null;
        visitedAtUtc: Date | null;
        provenance: string | null;
      }>
    >;
  };
};
const openTransaction = new AsyncLocalStorage<TripReader>();

// One client, one `$transaction` wrapper (below): it both scopes the change ledger and binds
// the interactive transaction for the hook's own lookups. A second client extension around
// `$transaction` would hand callbacks a transaction client of the inner client, which does not
// carry the ledger wrapper, so a nested transaction would escape the ledger's scoping.
export const prisma = queried;

/** Runs an interactive transaction's callback with its client bound for the hook's lookups. */
function bindOpenTransaction(arg: unknown): unknown {
  if (typeof arg !== "function") return arg;
  const callback = arg as (tx: unknown) => Promise<unknown>;
  return (tx: unknown) => openTransaction.run(tx as TripReader, () => callback(tx));
}

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
  const originalMessage = error instanceof Error ? error.message : "Unknown error";
  const errorMessage = model?.startsWith("TravelPlan")
    ? "Planning database operation failed"
    : error instanceof Error
      ? error.message
      : "Unknown error";
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

  if (expectedBusyWait.getStore() && BUSY_WAIT.test(originalMessage)) {
    dbLogger.debug({
      ...entry,
      operation: "database_expected_busy_wait",
      message: `${model}.${operation} - gave up waiting, retried by the caller`,
      error: { code: typeof code === "string" ? code : undefined },
    });
    return;
  }

  // Connection errors are expected during startup and shutdown: a warning.
  if (CONNECTION_ERROR_MARKERS.some((marker) => originalMessage.includes(marker))) {
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
      stack: !model?.startsWith("TravelPlan") && error instanceof Error ? error.stack : undefined,
    },
  });
}

/**
 * Every `$transaction` carries its ledger rows with it: they are collected
 * while it runs and queued only once it committed, so a rolled-back write
 * leaves no history (services/changeLedger/capture.ts, `runLedgerTransaction`).
 * The extension API has no hook for a transaction's end, hence the wrapper.
 */
{
  // Unbound: a transaction client inherits this property, and its own
  // `tx.$transaction` (a nested transaction, Prisma 7) must stay Prisma's —
  // bound to the top client it would open a second, independent transaction
  // that waits on the first one's locks.
  const original = prisma.$transaction as unknown as (...a: unknown[]) => Promise<unknown>;
  const top = prisma;
  (prisma as unknown as { $transaction: unknown }).$transaction = function (
    this: unknown,
    arg: unknown,
    options?: unknown
  ) {
    const bound = bindOpenTransaction(arg);
    if (this !== top) {
      return runNestedLedgerTransaction(
        (...a: unknown[]) => original.apply(this, a),
        bound,
        options
      );
    }
    return runLedgerTransaction((...a: unknown[]) => original.apply(top, a), bound, options);
  };
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
