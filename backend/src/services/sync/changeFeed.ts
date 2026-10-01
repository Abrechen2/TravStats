import { prisma } from "../../db";
import { comparePosition, encodeCursor, type DeltaCursor, type FullCursor } from "./cursor";
import { SYNC_ENTITIES, rowVersion, syncEntity, toSyncRecord, type SyncEntity } from "./entities";
import { scopeFingerprint, type SyncScope } from "./scope";
import { loadSyncState, type SyncStateRow } from "./state";

/**
 * `GET /sync/changes` — the feed itself. See `cursor.ts` for why the cursor
 * is a transaction position and not a time.
 */

export type SyncChangeItem =
  | {
      entity: string;
      id: string;
      op: "upsert";
      /** The record's version for If-Match / baseVersion; null when unversioned. */
      version: string | null;
      record: Record<string, unknown>;
    }
  | { entity: string; id: string; op: "delete" };

export interface SyncPage {
  mode: "full" | "delta";
  changes: SyncChangeItem[];
  cursor: string;
  /** Ask again at once: this answer was cut at `limit`, or a full read just ended. */
  hasMore: boolean;
}

export type ResyncReason = "epochChanged" | "scopeChanged" | "cursorExpired" | "cursorFromFuture";

/** Thrown when the cursor cannot be continued; the route answers 410. */
export class ResyncRequiredError extends Error {
  readonly reason: ResyncReason;
  constructor(reason: ResyncReason) {
    super(`Sync cursor cannot be continued: ${reason}`);
    this.name = "ResyncRequiredError";
    this.reason = reason;
  }
}

interface Horizon {
  xmin: bigint;
  xmax: bigint;
}

interface ChangeRow {
  seq: bigint;
  xid: bigint;
  entity: string;
  entityId: string;
  op: string;
  kind: string | null;
}

/**
 * The reading snapshot's horizon and, in the SAME statement — so under the
 * same snapshot — the next change rows below it. A second statement would
 * take a new snapshot, and rows committed in between would sit above a
 * horizon measured before them.
 */
async function readChanges(
  userId: string,
  after: { xid: bigint; seq: bigint },
  take: number
): Promise<{ horizon: Horizon; rows: ChangeRow[] }> {
  const result = await prisma.$queryRaw<
    Array<{
      xmin: bigint;
      xmax: bigint;
      seq: bigint | null;
      xid: bigint | null;
      entity: string | null;
      entity_id: string | null;
      op: string | null;
      kind: string | null;
    }>
  >`
    SELECT h.xmin, h.xmax, c.seq, c.xid, c.entity, c.entity_id, c.op, c.kind
    FROM (
      SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint AS xmin,
             pg_snapshot_xmax(pg_current_snapshot())::text::bigint AS xmax
    ) h
    LEFT JOIN LATERAL (
      SELECT c.seq, c.xid, c.entity, c.entity_id, c.op, c.kind
      FROM sync_changes c
      WHERE c.user_id = ${userId}
        AND (c.xid, c.seq) > (${after.xid}::bigint, ${after.seq}::bigint)
        AND c.xid < h.xmin
      ORDER BY c.xid, c.seq
      LIMIT ${take}
    ) c ON true`;
  const first = result[0];
  if (!first) throw new Error("sync horizon query returned no row");
  const rows: ChangeRow[] = result
    .filter((row) => row.seq !== null)
    .map((row) => ({
      seq: row.seq as bigint,
      xid: row.xid as bigint,
      entity: row.entity as string,
      entityId: row.entity_id as string,
      op: row.op as string,
      kind: row.kind,
    }));
  return { horizon: { xmin: first.xmin, xmax: first.xmax }, rows };
}

async function readHorizon(): Promise<Horizon> {
  const [row] = await prisma.$queryRaw<Horizon[]>`
    SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint AS xmin,
           pg_snapshot_xmax(pg_current_snapshot())::text::bigint AS xmax`;
  if (!row) throw new Error("sync horizon query returned no row");
  return row;
}

/**
 * Current rows for a batch of ids, as feed items. A row that is gone, or
 * that this account may no longer see, becomes a delete: whatever the change
 * row said, the client's copy must go. (A delete transaction can hold a
 * smaller xid than an insert it raced, so a tombstone may sort BEFORE the
 * upsert of the same id in one page; answering with the current truth makes
 * that order harmless.)
 */
async function materialise(
  entity: SyncEntity,
  ids: string[],
  userId: string,
  scope: SyncScope
): Promise<Map<string, SyncChangeItem>> {
  const rows = await entity.find({
    where: { AND: [{ id: { in: ids } }, entity.ownerWhere(userId)] },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items = new Map<string, SyncChangeItem>();
  for (const id of ids) {
    const row = byId.get(id);
    items.set(
      id,
      row && entity.visible(row, scope)
        ? {
            entity: entity.name,
            id,
            op: "upsert",
            version: rowVersion(entity, row),
            record: toSyncRecord(entity, row),
          }
        : { entity: entity.name, id, op: "delete" }
    );
  }
  return items;
}

function assertContinuable(
  cursor: { epoch: string; scope: string },
  state: SyncStateRow,
  scope: SyncScope
): void {
  if (cursor.epoch !== state.epoch) throw new ResyncRequiredError("epochChanged");
  if (cursor.scope !== scopeFingerprint(scope)) throw new ResyncRequiredError("scopeChanged");
}

export async function readDeltaPage(
  userId: string,
  cursor: DeltaCursor,
  scope: SyncScope,
  limit: number
): Promise<SyncPage> {
  const state = await loadSyncState();
  assertContinuable(cursor, state, scope);
  if (comparePosition(cursor, { xid: state.prunedXid, seq: state.prunedSeq }) < 0) {
    throw new ResyncRequiredError("cursorExpired");
  }

  const { horizon, rows } = await readChanges(userId, cursor, limit + 1);
  // A cursor ahead of every transaction this database has ever started
  // comes from another database — one restored into a fresh cluster whose
  // counter restarted lower. Continuing it would skip everything below it.
  if (cursor.xid > horizon.xmax) throw new ResyncRequiredError("cursorFromFuture");

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  // Caught up: every transaction below xmin has been handed out, so the next
  // read starts at xmin. (xmin, 0) sorts before any real row of xmin — seq
  // starts at 1.
  const caughtUp = { xid: horizon.xmin, seq: 0n };
  const next = hasMore && last ? { xid: last.xid, seq: last.seq } : caughtUp;
  const position = comparePosition(next, cursor) > 0 ? next : cursor;

  const changes = await collapse(page, userId, scope);
  return {
    mode: "delta",
    changes,
    cursor: encodeCursor({ ...cursor, xid: position.xid, seq: position.seq }),
    hasMore,
  };
}

/** One item per record — its latest state — in the order of its last change. */
async function collapse(
  rows: ChangeRow[],
  userId: string,
  scope: SyncScope
): Promise<SyncChangeItem[]> {
  const latest = new Map<string, ChangeRow>();
  for (const row of rows) {
    const key = `${row.entity}:${row.entityId}`;
    latest.delete(key);
    latest.set(key, row);
  }
  const ordered = [...latest.values()].filter((row) => syncEntity(row.entity)?.reachable(scope));

  const upsertIds = new Map<string, string[]>();
  for (const row of ordered) {
    if (row.op !== "upsert") continue;
    upsertIds.set(row.entity, [...(upsertIds.get(row.entity) ?? []), row.entityId]);
  }
  const loaded = new Map<string, Map<string, SyncChangeItem>>();
  for (const [name, ids] of upsertIds) {
    const entity = syncEntity(name) as SyncEntity;
    loaded.set(name, await materialise(entity, ids, userId, scope));
  }

  const items: SyncChangeItem[] = [];
  for (const row of ordered) {
    const entity = syncEntity(row.entity) as SyncEntity;
    if (row.op === "delete") {
      if (entity.tombstoneVisible(row.kind, scope)) {
        items.push({ entity: entity.name, id: row.entityId, op: "delete" });
      }
      continue;
    }
    // An upsert that materialised as a delete is always passed on: the
    // record may have been visible to this client a moment ago (a tour moved
    // to the hidden roadtrip domain), and a delete for an id the client never
    // had costs nothing.
    const item = loaded.get(row.entity)?.get(row.entityId);
    if (item) items.push(item);
  }
  return items;
}

/**
 * The first read, and every read after "resync required": the account's
 * current records, entity by entity in id order, then the delta from the
 * horizon taken when the full read began. Anything written meanwhile has an
 * xid at or above that horizon, so the delta brings it — at worst twice,
 * never not at all.
 */
export async function readFullPage(
  userId: string,
  cursor: FullCursor | null,
  scope: SyncScope,
  limit: number
): Promise<SyncPage> {
  const state = await loadSyncState();
  const start: FullCursor = cursor ?? {
    mode: "full",
    epoch: state.epoch,
    scope: scopeFingerprint(scope),
    startXid: (await readHorizon()).xmin,
    entityIndex: 0,
    afterId: null,
  };
  if (cursor) assertContinuable(cursor, state, scope);

  const changes: SyncChangeItem[] = [];
  let entityIndex = start.entityIndex;
  let afterId = start.afterId;
  while (entityIndex < SYNC_ENTITIES.length && changes.length < limit) {
    const entity = SYNC_ENTITIES[entityIndex];
    const take = limit - changes.length;
    const rows = await entity.find({
      where: { AND: [entity.ownerWhere(userId), afterId === null ? {} : { id: { gt: afterId } }] },
      orderBy: { id: "asc" },
      take,
    });
    for (const row of rows) {
      if (!entity.visible(row, scope)) continue;
      changes.push({
        entity: entity.name,
        id: row.id,
        op: "upsert",
        version: rowVersion(entity, row),
        record: toSyncRecord(entity, row),
      });
    }
    if (rows.length < take) {
      entityIndex += 1;
      afterId = null;
    } else {
      afterId = rows[rows.length - 1].id;
    }
  }

  if (entityIndex >= SYNC_ENTITIES.length) {
    const delta: DeltaCursor = {
      mode: "delta",
      epoch: start.epoch,
      scope: start.scope,
      xid: start.startXid,
      seq: 0n,
    };
    return { mode: "full", changes, cursor: encodeCursor(delta), hasMore: true };
  }
  return {
    mode: "full",
    changes,
    cursor: encodeCursor({ ...start, entityIndex, afterId }),
    hasMore: true,
  };
}
