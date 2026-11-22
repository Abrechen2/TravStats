import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../../prisma";
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
import { appliedValue, encodeValue, UNKNOWN } from "./values";

/**
 * The capture point of the change ledger: called by the query hook in `db.ts`
 * around every write to a tracked model.
 *
 * Budget (spec §Performance): a tracked update that touches a recorded field
 * costs ONE extra read — the before-snapshot of exactly those fields — on the
 * base client; the ledger rows are queued and written in batches, one
 * `createMany` per flush, never one insert per write. A write that touches no
 * recorded field (a version claim, a geometry refresh) costs nothing. The
 * ledger's own queries run on the unextended client, so they never re-enter
 * the hook and are not counted by `observeQueries`; `ledgerStats()` counts them
 * instead, for the guard that holds this budget.
 *
 * Known limit: the snapshot and the insert run outside an enclosing
 * interactive transaction. A transaction that rolls back after its write can
 * leave a row describing a change that did not land (spec §Limits).
 */

const UPDATE_OPS = new Set(["update", "updateMany", "upsert"]);
const DELETE_OPS = new Set(["delete", "deleteMany"]);
/** Above this many matched rows a bulk write is a migration, not an edit: logged, not recorded. */
export const MAX_SNAPSHOT_ROWS = 5000;
const FLUSH_DELAY_MS = 200;
const FLUSH_AT_ROWS = 500;

export interface LedgerRow {
  userId: string;
  changeSetId: string;
  entityType: string;
  entityId: string;
  operation: "update" | "delete";
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  omitted: boolean;
  label: string | null;
  source: string;
  actorUserId: string | null;
  reason: string | null;
  restoredFromId: string | null;
}

type Row = Record<string, unknown>;
type Delegate = {
  findMany(args: unknown): Promise<Row[]>;
};

let base: PrismaClient | null = null;
let queue: LedgerRow[] = [];
let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> = Promise.resolve();
const stats = { snapshotReads: 0, inserts: 0, rows: 0 };

/** Wired once by `db.ts` with the unextended client. */
export function configureChangeLedger(client: PrismaClient): void {
  base = client;
}

/** The ledger's own query counts since the last reset — for the budget guard. */
export function ledgerStats(): Readonly<typeof stats> {
  return { ...stats };
}
export function resetLedgerStats(): void {
  stats.snapshotReads = 0;
  stats.inserts = 0;
  stats.rows = 0;
}

function scheduleFlush(): void {
  if (queue.length >= FLUSH_AT_ROWS) {
    void flushChangeLedger();
    return;
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushChangeLedger();
  }, FLUSH_DELAY_MS);
  timer.unref?.();
}

/**
 * Write every queued row now. Awaited by a restore (so its answer shows the
 * new row) and by tests; a failed insert is logged with its size and never
 * thrown into the write it describes.
 */
export function flushChangeLedger(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const batch = queue;
  queue = [];
  inFlight = inFlight.then(async () => {
    if (batch.length === 0 || !base) return;
    try {
      // An account deleted while its rows waited would fail the whole batch on
      // the foreign key, and with it every other account's rows: its rows go
      // with it, as the cascade would have taken them.
      const owners = [...new Set(batch.map((r) => r.userId))];
      const alive = new Set(
        (await base.user.findMany({ where: { id: { in: owners } }, select: { id: true } })).map(
          (u) => u.id
        )
      );
      const rows = batch.filter((r) => alive.has(r.userId));
      if (rows.length === 0) return;
      stats.inserts += 1;
      stats.rows += rows.length;
      await base.changeLedgerEntry.createMany({ data: rows });
    } catch (error) {
      dbLogger.error({
        operation: "change_ledger_write_failed",
        message: `change ledger lost ${batch.length} row(s)`,
        error: { name: error instanceof Error ? error.name : typeof error },
      });
    }
  });
  return inFlight;
}

function enqueue(rows: LedgerRow[]): void {
  if (rows.length === 0) return;
  queue.push(...rows);
  scheduleFlush();
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

async function snapshot(
  model: TrackedModel,
  meta: ModelMeta,
  where: unknown,
  fields: readonly string[]
): Promise<Row[] | null> {
  if (!base) return null;
  const delegate = (base as unknown as Record<string, Delegate>)[delegateOf(model)];
  stats.snapshotReads += 1;
  const rows = await delegate.findMany({
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
      const next =
        stored && Object.prototype.hasOwnProperty.call(stored, field)
          ? stored[field]
          : appliedValue(data[field], row[field], f.type, f.isList);
      if (next === UNKNOWN) continue;
      const oldEnc = encodeValue(row[field]);
      const newEnc = encodeValue(next);
      // A no-op write keeps nothing. Two omitted values cannot be compared and
      // are treated as unchanged rather than guessed at.
      if (oldEnc.omitted && newEnc.omitted) continue;
      if (!oldEnc.omitted && !newEnc.omitted && oldEnc.value === newEnc.value) continue;
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

/** True when the hook must route this query through `captureWrite`. */
export function isCapturedWrite(model: string | undefined, operation: string): boolean {
  return isTrackedModel(model) && (UPDATE_OPS.has(operation) || DELETE_OPS.has(operation));
}

/**
 * Run `run` (the write) and queue the ledger rows it produced. A failure of the
 * ledger itself is logged and never fails the write; a failure of the write
 * records nothing.
 */
export async function captureWrite<T>(
  model: string,
  operation: string,
  args: unknown,
  run: () => Promise<T>
): Promise<T> {
  if (!isTrackedModel(model) || !base) return run();
  const ctx = resolveChangeContext();
  if (!ctx) return run();
  const meta = modelMeta(model);
  const a = (args ?? {}) as Row;
  const isDelete = DELETE_OPS.has(operation);
  const data = ((operation === "upsert" ? a.update : a.data) ?? {}) as Row;
  const fields = isDelete ? [] : recordedFields(data, meta);
  if (!isDelete && fields.length === 0) return run();

  let before: Row[] | null = null;
  try {
    before = await snapshot(model, meta, a.where, fields);
  } catch (error) {
    dbLogger.error({
      operation: "change_ledger_snapshot_failed",
      message: `${model}.${operation} not recorded`,
      error: { name: error instanceof Error ? error.name : typeof error },
    });
  }
  const result = await run();
  if (!before || before.length === 0) return result;
  try {
    enqueue(
      isDelete
        ? deleteRows(ctx, model, meta, before)
        : updateRows(ctx, model, meta, before, data, fields, result)
    );
  } catch (error) {
    dbLogger.error({
      operation: "change_ledger_diff_failed",
      message: `${model}.${operation} not recorded`,
      error: { name: error instanceof Error ? error.name : typeof error },
    });
  }
  return result;
}
