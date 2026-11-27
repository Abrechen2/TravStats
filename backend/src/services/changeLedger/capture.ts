import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "../../prisma";
import { dbLogger } from "../../utils/logger";
import { resolveChangeContext, type ResolvedChangeContext } from "./context";
import {
  delegateOf,
  IGNORED_FIELDS,
  isTrackedModel,
  labelOf,
  modelMeta,
  TRACKED_MODELS,
  type ModelMeta,
  type TrackedModel,
} from "./models";
import { appliedValue, encodeValue, sameRaw, UNKNOWN } from "./values";

/**
 * The capture point of the change ledger: called by the query hook in `db.ts`
 * around every write to a tracked model.
 *
 * A history row commits or rolls back WITH the change it describes — never a
 * row for a change that did not land, never a committed change without its row
 * (spec §Transactions):
 *
 * - Inside an interactive `$transaction` (wrapped in `db.ts`, nested ones
 *   included) the snapshot is read through that transaction's own client, so it
 *   sees the transaction's earlier writes and needs no second connection; the
 *   rows are collected in the transaction's scope and inserted through the same
 *   client when its callback returns, before the commit. The snapshot and the
 *   insert each run in a savepoint (a nested transaction), so a ledger failure
 *   is logged, counted and never aborts the caller's work. A nested transaction that rolls back takes its
 *   rows with it.
 * - A write outside any transaction: snapshot, write and rows as three plain
 *   statements, so no connection is held longer than the write alone holds
 *   it. A crash between write and insert loses its rows, never invents one.
 * - The array form `$transaction([...])` cannot carry extra statements: its
 *   snapshots read committed values on the base client and its rows are
 *   inserted right after it committed (a crash in between loses them; a
 *   rollback drops them).
 *
 * Budget (spec §Performance): a tracked write touching a recorded field costs
 * one snapshot read; a transaction costs one insert (in chunks of
 * `INSERT_CHUNK`) for all its rows. A write touching no recorded field costs
 * nothing. The ledger's own statements are not counted by `observeQueries`;
 * `ledgerStats()` counts them for the guard that holds this budget.
 */

const UPDATE_OPS = new Set(["update", "updateMany", "upsert"]);
const DELETE_OPS = new Set(["delete", "deleteMany"]);
/** Writes that name one row: their snapshot can take the one-round-trip path. */
const SINGLE_ROW_OPS = new Set(["update", "upsert", "delete"]);
/** Above this many matched rows a bulk write is a migration, not an edit: logged, not recorded. */
export const MAX_SNAPSHOT_ROWS = 5000;
const INSERT_CHUNK = 1000;

export interface LedgerRow {
  userId: string;
  changeSetId: string;
  entityType: string;
  entityId: string;
  operation: "update" | "delete" | "create";
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  omitted: boolean;
  label: string | null;
  source: string;
  actorUserId: string | null;
  reason: string | null;
  restoredFromId: string | null;
  /** When the write happened, not when its transaction committed. */
  createdAt: Date;
}

type Row = Record<string, unknown>;
type Delegate = {
  findMany(args: unknown): Promise<Row[]>;
} & Record<string, (args: unknown) => Promise<unknown>>;
type RawCapable = {
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
};
/** A client that can open a (nested) transaction: the base client or a transaction client. */
type TxCapable = {
  $transaction: (fn: (tx: unknown) => Promise<unknown>, options?: unknown) => Promise<unknown>;
} & Record<string, unknown>;

let base: PrismaClient | null = null;
const stats = {
  snapshotReads: 0,
  inserts: 0,
  rows: 0,
  savepoints: 0,
  snapshotFailures: 0,
  insertFailures: 0,
};

/** A test seam: make the next snapshots or inserts fail with a real database error. */
let injectedFault: "snapshot" | "insert" | null = null;
export function injectLedgerFaultForTests(kind: "snapshot" | "insert" | null): void {
  injectedFault = kind;
}
async function maybeFail(client: unknown, kind: "snapshot" | "insert"): Promise<void> {
  if (injectedFault !== kind) return;
  // Division by zero: a database error that aborts a transaction like any other.
  await (client as { $executeRawUnsafe: (q: string) => Promise<unknown> }).$executeRawUnsafe(
    "SELECT 1/0"
  );
}

/** Off switch for measurements (spec §Performance); not wired to configuration. */
let enabled = true;
export function setChangeLedgerEnabled(on: boolean): void {
  enabled = on;
}

/**
 * Run `fn` in a savepoint of the transaction `tx` (a nested transaction):
 * a failure rolls back only the savepoint, so the caller's transaction is
 * never aborted by the ledger.
 */
function inSavepoint<T>(tx: unknown, fn: (sp: unknown) => Promise<T>): Promise<T> {
  stats.savepoints += 1;
  return asInternal(() => (tx as TxCapable).$transaction(fn) as Promise<T>);
}

/** One running transaction: its client (null for the array form) and the rows it produced. */
interface TxScope {
  tx: unknown | null;
  pending: LedgerRow[];
}
const txScope = new AsyncLocalStorage<TxScope>();
const internal = new AsyncLocalStorage<true>();

/** True while the ledger itself queries through a transaction client (`db.ts` skips the hook). */
export function isLedgerInternal(): boolean {
  return internal.getStore() === true;
}

const asInternal = <T>(fn: () => Promise<T>): Promise<T> =>
  internal.run(true, async () => await fn());

/**
 * Insert `rows` through `client` inside a nested transaction (a savepoint): a
 * failure — an account deleted meanwhile, a full disk — rolls back only the
 * savepoint, is logged with the count, and leaves the caller's work intact.
 */
async function insertRows(client: unknown, rows: LedgerRow[]): Promise<void> {
  if (rows.length === 0) return;
  let lost = 0;
  try {
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const payload = JSON.stringify(
        chunk.map((r) => ({
          // A NOT NULL violation stands in for any database failure in tests.
          user_id: injectedFault === "insert" ? null : r.userId,
          change_set_id: r.changeSetId,
          entity_type: r.entityType,
          entity_id: r.entityId,
          operation: r.operation,
          field: r.field,
          old_value: r.oldValue,
          new_value: r.newValue,
          omitted: r.omitted,
          label: r.label,
          source: r.source,
          actor_user_id: r.actorUserId,
          reason: r.reason,
          restored_from_id: r.restoredFromId,
          created_at: r.createdAt.toISOString(),
        }))
      );
      stats.inserts += 1;
      // `change_ledger_insert()` inserts inside an exception block (a savepoint
      // on the server): one round trip, and a failure is -1, never an aborted
      // transaction.
      const call = () =>
        (client as RawCapable).$queryRawUnsafe<{ n: number }[]>(
          "SELECT change_ledger_insert($1::jsonb) AS n",
          payload
        );
      const [{ n }] = client === base ? await call() : await asInternal(call);
      if (n < 0) lost += chunk.length;
      else stats.rows += n;
    }
  } catch (error) {
    lost = rows.length;
    dbLogger.error({
      operation: "change_ledger_write_failed",
      message: `change ledger insert call failed`,
      error: { name: error instanceof Error ? error.name : typeof error },
    });
  }
  if (lost > 0) {
    stats.insertFailures += 1;
    dbLogger.error({
      operation: "change_ledger_write_failed",
      message: `change ledger lost ${lost} row(s)`,
    });
  }
}

/**
 * Run a top-level `$transaction` (`raw`, bound to the extended client) with a
 * ledger scope. Interactive form: the rows go in through `tx` before the
 * callback returns, so they commit with it. Array form: inserted right after
 * the commit, dropped on a rollback.
 */
export async function runLedgerTransaction(
  raw: (...a: unknown[]) => Promise<unknown>,
  arg: unknown,
  options?: unknown
): Promise<unknown> {
  const extra = options === undefined ? [] : [options];
  if (typeof arg === "function") {
    return raw((tx: unknown) => inScope(tx, arg as (tx: unknown) => Promise<unknown>), ...extra);
  }
  const scope: TxScope = { tx: null, pending: [] };
  const result = await txScope.run(scope, async () => await raw(arg, ...extra));
  if (base) await insertRows(base, scope.pending);
  return result;
}

/**
 * A nested `tx.$transaction(fn)`: Prisma's own (a savepoint), with a scope of
 * its own so its rows roll back with it. `raw` is Prisma's method bound to `tx`.
 */
export function runNestedLedgerTransaction(
  raw: (...a: unknown[]) => Promise<unknown>,
  arg: unknown,
  options?: unknown
): Promise<unknown> {
  const extra = options === undefined ? [] : [options];
  if (typeof arg !== "function") return raw(arg, ...extra);
  return raw((tx: unknown) => inScope(tx, arg as (tx: unknown) => Promise<unknown>), ...extra);
}

function inScope(tx: unknown, fn: (tx: unknown) => Promise<unknown>): Promise<unknown> {
  const scope: TxScope = { tx, pending: [] };
  return txScope.run(scope, async () => {
    const result = await fn(tx);
    await insertRows(tx, scope.pending);
    return result;
  });
}

/** Wired once by `db.ts` with the unextended client. */
export function configureChangeLedger(client: PrismaClient): void {
  base = client;
}

/** The ledger's own statement counts since the last reset — for the budget guard. */
export function ledgerStats(): Readonly<typeof stats> {
  return { ...stats };
}
export function resetLedgerStats(): void {
  for (const key of Object.keys(stats) as (keyof typeof stats)[]) stats[key] = 0;
}

/** A unique `where` as a plain filter: compound keys (`userId_clientRef`) are spread out. */
function filterOf(where: unknown, meta: ModelMeta): Row {
  if (!where || typeof where !== "object") return {};
  const out: Row = {};
  for (const [key, value] of Object.entries(where as Row)) {
    const compound =
      !meta.scalars.has(key) &&
      !["AND", "OR", "NOT"].includes(key) &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      key.includes("_");
    if (compound) Object.assign(out, value as Row);
    else out[key] = value;
  }
  return out;
}

function recordedFields(data: unknown, meta: ModelMeta): string[] {
  if (!data || typeof data !== "object") return [];
  return Object.keys(data as Row).filter(
    (key) => meta.scalars.has(key) && !IGNORED_FIELDS.has(key) && (data as Row)[key] !== undefined
  );
}

function ownerOf(meta: ModelMeta, row: Row): string | null {
  if (meta.owner.kind === "column") return (row.userId as string | undefined) ?? null;
  const parent = row[meta.owner.relation] as Row | null | undefined;
  return (parent?.userId as string | undefined) ?? null;
}

function selectFor(meta: ModelMeta, fields: readonly string[]): Row {
  const select: Row = { id: true };
  if (meta.owner.kind === "column") select.userId = true;
  else select[meta.owner.relation] = { select: { userId: true } };
  for (const f of [...fields, ...meta.labelFields]) select[f] = true;
  return select;
}

function readRows(client: unknown, model: TrackedModel, args: unknown): Promise<Row[]> {
  stats.snapshotReads += 1;
  const read = async (c: unknown) => {
    await maybeFail(c, "snapshot");
    return (c as Record<string, Delegate>)[delegateOf(model)].findMany(args);
  };
  // Inside the caller's transaction the read runs in a savepoint: a failing
  // read must not abort the transaction it only observes.
  return client === base ? read(client) : inSavepoint(client, read);
}

/** `where` names one row by id (and owner): the one-round-trip snapshot applies. */
function singleRowKey(
  meta: ModelMeta,
  operation: string,
  where: unknown
): { id: string; userId: string | null } | null {
  if (meta.owner.kind !== "column" || !SINGLE_ROW_OPS.has(operation)) return null;
  if (!where || typeof where !== "object") return null;
  const w = where as Row;
  if (Object.keys(w).some((k) => k !== "id" && k !== "userId")) return null;
  if (typeof w.id !== "string") return null;
  if (w.userId !== undefined && typeof w.userId !== "string") return null;
  return { id: w.id, userId: (w.userId as string | undefined) ?? null };
}

/** A column value as `to_jsonb` hands it back, in the type Prisma would. */
function fromJson(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  if (type === "DateTime" && typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`);
    return new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
  }
  if (type === "Decimal") return new Prisma.Decimal(String(value));
  if (type === "BigInt") return BigInt(String(value));
  return value;
}

/**
 * The snapshot of one row in ONE round trip: `change_ledger_snapshot()` reads
 * it inside an exception block (a savepoint on the server), so a failure comes
 * back as `ok: false` and never aborts the caller's transaction.
 */
async function snapshotRow(
  client: unknown,
  meta: ModelMeta,
  key: { id: string; userId: string | null },
  fields: readonly string[]
): Promise<Row[]> {
  stats.snapshotReads += 1;
  const table = injectedFault === "snapshot" ? "pg_class" : meta.table;
  const call = () =>
    (client as RawCapable).$queryRawUnsafe<{ s: { ok: boolean; row: Row | null } }[]>(
      "SELECT change_ledger_snapshot($1::regclass, $2, $3) AS s",
      `"${table}"`,
      key.id,
      key.userId
    );
  const [{ s }] = client === base ? await call() : await asInternal(call);
  if (!s.ok) throw new Error("change ledger snapshot failed in the database");
  if (!s.row) return [];
  const raw = s.row;
  const out: Row = {};
  for (const f of new Set(["id", "userId", ...fields, ...meta.labelFields])) {
    const column = meta.columns.get(f);
    const type = meta.scalars.get(f)?.type ?? "String";
    if (column) out[f] = fromJson(raw[column], type);
  }
  return [out];
}

async function snapshot(
  client: unknown,
  model: TrackedModel,
  meta: ModelMeta,
  where: unknown,
  fields: readonly string[],
  operation: string
): Promise<Row[] | null> {
  const key = singleRowKey(meta, operation, where);
  if (key) return snapshotRow(client, meta, key, fields);
  const rows = await readRows(client, model, {
    where: filterOf(where, meta),
    select: selectFor(meta, fields),
    take: MAX_SNAPSHOT_ROWS + 1,
  });
  if (rows.length > MAX_SNAPSHOT_ROWS) {
    dbLogger.warn({
      operation: "change_ledger_bulk_skipped",
      message: `${model} write over ${MAX_SNAPSHOT_ROWS} rows is not recorded`,
    });
    return null;
  }
  return rows;
}

function common(
  ctx: ResolvedChangeContext,
  model: TrackedModel,
  userId: string,
  row: Row,
  meta: ModelMeta
) {
  return {
    userId,
    entityType: TRACKED_MODELS[model],
    entityId: String(row.id),
    label: labelOf(meta, row),
    source: ctx.source,
    actorUserId: ctx.actorUserId,
    reason: ctx.reason,
    restoredFromId: ctx.restoredFromId,
    createdAt: new Date(),
  };
}

function updateRows(
  ctx: ResolvedChangeContext,
  model: TrackedModel,
  meta: ModelMeta,
  before: Row[],
  data: Row,
  fields: readonly string[],
  result: unknown
): LedgerRow[] {
  const out: LedgerRow[] = [];
  // A single update hands back the row as stored; it beats re-deriving the value.
  const stored =
    before.length === 1 && result && typeof result === "object" && !Array.isArray(result)
      ? (result as Row)
      : null;
  for (const row of before) {
    const userId = ownerOf(meta, row);
    if (!userId) continue;
    const changeSetId = randomUUID();
    for (const field of fields) {
      const f = meta.scalars.get(field);
      if (!f) continue;
      const old = row[field];
      const next =
        stored && Object.prototype.hasOwnProperty.call(stored, field)
          ? stored[field]
          : appliedValue(data[field], old, f.type, f.isList);
      if (next === UNKNOWN) continue;
      const oldEnc = encodeValue(old);
      const newEnc = encodeValue(next);
      // A no-op write keeps nothing. Two values too large to keep are compared
      // in full: a change between them is still a change, recorded as omitted.
      if (oldEnc.omitted && newEnc.omitted) {
        if (sameRaw(old, next)) continue;
      } else if (!oldEnc.omitted && !newEnc.omitted && oldEnc.value === newEnc.value) continue;
      const omitted = oldEnc.omitted || newEnc.omitted;
      out.push({
        ...common(ctx, model, userId, row, meta),
        changeSetId,
        operation: "update",
        field,
        oldValue: omitted ? null : oldEnc.value,
        newValue: omitted ? null : newEnc.value,
        omitted,
      });
    }
  }
  return out;
}

function deleteRows(
  ctx: ResolvedChangeContext,
  model: TrackedModel,
  meta: ModelMeta,
  before: Row[]
): LedgerRow[] {
  return before.flatMap((row) => {
    const userId = ownerOf(meta, row);
    if (!userId) return [];
    return [
      {
        ...common(ctx, model, userId, row, meta),
        changeSetId: randomUUID(),
        operation: "delete" as const,
        field: null,
        oldValue: null,
        newValue: null,
        omitted: false,
      },
    ];
  });
}

/**
 * The snapshot rows the write really changed. A bulk write reports only a
 * count; when it differs from the snapshot (a concurrent edit moved a row out
 * of the filter, another request deleted one first), the rows are read again:
 * a deleted row must be gone, an updated one must now hold the written value.
 */
async function reconcile(
  client: unknown,
  model: TrackedModel,
  meta: ModelMeta,
  operation: string,
  before: Row[],
  data: Row,
  fields: readonly string[],
  result: unknown
): Promise<Row[]> {
  const count = (result as { count?: unknown } | null)?.count;
  if (typeof count !== "number" || count === before.length) return before;
  if (count === 0) return [];
  const now = await readRows(client, model, {
    where: { id: { in: before.map((r) => r.id) } },
    select: selectFor(meta, fields),
  });
  const byId = new Map(now.map((r) => [r.id, r]));
  if (DELETE_OPS.has(operation)) return before.filter((r) => !byId.has(r.id));
  return before.filter((r) => {
    const current = byId.get(r.id);
    if (!current) return false;
    return fields.every((field) => {
      const f = meta.scalars.get(field);
      const next = f ? appliedValue(data[field], r[field], f.type, f.isList) : UNKNOWN;
      return next === UNKNOWN || sameRaw(current[field], next);
    });
  });
}

/** True when the hook must route this query through `captureWrite`. */
export function isCapturedWrite(model: string | undefined, operation: string): boolean {
  return isTrackedModel(model) && (UPDATE_OPS.has(operation) || DELETE_OPS.has(operation));
}

function logLedgerError(operation: string, model: string, writeOp: string, error: unknown): void {
  dbLogger.error({
    operation,
    message: `${model}.${writeOp} not recorded`,
    error: { name: error instanceof Error ? error.name : typeof error },
  });
}

interface Planned {
  model: TrackedModel;
  operation: string;
  meta: ModelMeta;
  ctx: ResolvedChangeContext;
  where: unknown;
  data: Row;
  fields: string[];
  isDelete: boolean;
}

/** The ledger rows of one write, from its snapshot and its result. */
async function rowsOf(
  client: unknown,
  p: Planned,
  before: Row[],
  result: unknown
): Promise<LedgerRow[]> {
  try {
    const touched = await reconcile(
      client,
      p.model,
      p.meta,
      p.operation,
      before,
      p.data,
      p.fields,
      result
    );
    return p.isDelete
      ? deleteRows(p.ctx, p.model, p.meta, touched)
      : updateRows(p.ctx, p.model, p.meta, touched, p.data, p.fields, result);
  } catch (error) {
    logLedgerError("change_ledger_diff_failed", p.model, p.operation, error);
    return [];
  }
}

/** Inside a transaction: snapshot through `scope.tx` (or base), rows into the scope. */
async function captureInScope<T>(p: Planned, scope: TxScope, run: () => Promise<T>): Promise<T> {
  const client = scope.tx ?? base;
  let before: Row[] | null = null;
  try {
    before = await snapshot(client, p.model, p.meta, p.where, p.fields, p.operation);
  } catch (error) {
    stats.snapshotFailures += 1;
    logLedgerError("change_ledger_snapshot_failed", p.model, p.operation, error);
  }
  const result = await run();
  if (before && before.length > 0) {
    for (const row of await rowsOf(client, p, before, result)) scope.pending.push(row);
  }
  return result;
}

/**
 * Outside any transaction: snapshot, the write, the rows — three separate
 * statements, each holding a pool connection only for itself, so no write
 * holds a connection longer than it did without the ledger (spec §Pool).
 * A failed snapshot means the write runs unrecorded; a failed insert is
 * logged. A crash between the write and the insert loses the rows (never
 * invents them).
 */
async function captureStandalone<T>(p: Planned, run: () => Promise<T>): Promise<T> {
  let before: Row[] | null = null;
  try {
    before = await snapshot(base, p.model, p.meta, p.where, p.fields, p.operation);
  } catch (error) {
    stats.snapshotFailures += 1;
    logLedgerError("change_ledger_snapshot_failed", p.model, p.operation, error);
  }
  const result = await run();
  if (before && before.length > 0) await insertRows(base, await rowsOf(base, p, before, result));
  return result;
}

/**
 * Run the write and record what it changed (see the head of this file for
 * where the rows go). A failure of the ledger is logged and never fails the
 * write; a failure of the write records nothing.
 */
export async function captureWrite<T>(
  model: string,
  operation: string,
  args: unknown,
  run: () => Promise<T>,
  inTransaction = false
): Promise<T> {
  if (!enabled || !isTrackedModel(model) || !base) return run();
  const ctx = resolveChangeContext();
  if (!ctx) return run();
  const meta = modelMeta(model);
  const a = (args ?? {}) as Row;
  const isDelete = DELETE_OPS.has(operation);
  const data = ((operation === "upsert" ? a.update : a.data) ?? {}) as Row;
  const fields = isDelete ? [] : recordedFields(data, meta);
  if (!isDelete && fields.length === 0) return run();
  const p: Planned = { model, operation, meta, ctx, where: a.where, data, fields, isDelete };

  if (inTransaction) {
    // Every transaction runs through the wrapper in db.ts, so a scope exists;
    // without one the rows would have nowhere to commit with, and are not kept.
    const scope = txScope.getStore();
    if (!scope) {
      logLedgerError("change_ledger_no_scope", model, operation, new Error("no transaction scope"));
      return run();
    }
    return captureInScope(p, scope, run);
  }
  return captureStandalone(p, run);
}

/**
 * A create made through travstats-mcp is the one create the ledger records: "via MCP / <token
 * label>" would otherwise show only on later edits. Ordinary creates stay unrecorded (an entry's
 * own `createdAt` is its birth); this is a row per MCP create, no field rows.
 */
export function isMcpCreate(model: string | undefined, operation: string): boolean {
  return (
    enabled &&
    operation === "create" &&
    isTrackedModel(model) &&
    resolveChangeContext()?.reason?.startsWith("via MCP") === true
  );
}

export async function captureMcpCreate<T>(
  model: string,
  run: () => Promise<T>,
  inTransaction = false
): Promise<T> {
  const result = await run();
  const ctx = resolveChangeContext();
  if (!ctx || !base || !isTrackedModel(model) || !result || typeof result !== "object")
    return result;
  try {
    const meta = modelMeta(model);
    const row = result as Row;
    const userId = ownerOf(meta, row) ?? ctx.actorUserId;
    if (!userId || row.id === undefined) return result;
    const ledgerRow: LedgerRow = {
      ...common(ctx, model, userId, row, meta),
      changeSetId: randomUUID(),
      operation: "create",
      field: null,
      oldValue: null,
      newValue: null,
      omitted: false,
    };
    const scope = inTransaction ? txScope.getStore() : undefined;
    if (scope) scope.pending.push(ledgerRow);
    else await insertRows(base, [ledgerRow]);
  } catch (error) {
    logLedgerError("change_ledger_create_failed", model, "create", error);
  }
  return result;
}
