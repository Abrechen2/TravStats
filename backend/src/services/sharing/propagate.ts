import { randomUUID } from "crypto";

import type { Db, DbTransaction } from "../../db";
import type { Prisma } from "../../prisma";
import { ADAPTERS, type EntityAdapter, type ShareEntity, type SharedRow } from "./adapters";
import { changedKeys, jsonSubset, sameFact } from "./factValues";
import { receivingMembers, type MemberTrip } from "./members";
import { asPropagation, isPropagating } from "./propagationGuard";

/**
 * Propagation (design 2026-10-09, decision 3, phase S2): after a member's
 * successful write to an entry of a shared trip, every other member's copy —
 * the row with the same `shareKey` in their trip of the same group — takes
 * the change, and they get a `ShareNotice` naming who changed what.
 *
 * Called explicitly by every write path of the six types (the coverage test
 * `propagate.writePaths.test.ts` lists them), never by a Prisma middleware:
 *
 *   const before = await shareSnapshot(tx, "flight", id);   // before the write
 *   … the write …
 *   await propagateWrite(tx, userId, "flight", id, before);
 *
 *   const gone = await shareSnapshot(tx, "flight", id);     // before a delete
 *   … the delete …
 *   await propagateDelete(tx, userId, gone);
 *
 * One function decides what a write was, from the entry's trip and key:
 *
 * - **create** — an unkeyed entry in a shared trip (new, or moved in): it gets
 *   a key, every receiving member a copy and a `created` notice.
 * - **update** — a keyed entry that stayed in its shared trip: the FACTS that
 *   this write changed (`before` vs now, by the whitelist) are applied to each
 *   copy that differs, with an `updated` notice carrying the copy's old values
 *   (`before`) and the new ones (`after`) — what undo restores. A write that
 *   changed only private fields changes nothing anywhere. Fields the writer did
 *   not touch are never pushed: a copy's own enrichment (a gate a provider
 *   filled in on one account only) is not overwritten by a stale value.
 * - **move out** — a keyed entry now outside its shared trip: its key is
 *   cleared and the members holding a copy get a `deleted` notice with reason
 *   `movedOut`. Their copies stay (deletes never propagate).
 * - **delete** — notices only, reason `deleted`; the others decide.
 *
 * A copy a member deleted or moved away is never re-created by a later change.
 *
 * Runs inside the caller's transaction when given one, else in its own. A
 * failure throws: a write path that is transactional rolls back with it, so
 * the member never sees "saved" for a change the others did not get.
 */

export type ShareClient = Db | DbTransaction;

/** An entry as it was, with the group its trip belonged to then. */
export interface ShareSnapshot extends SharedRow {
  entity: ShareEntity;
  groupId: string | null;
}

async function inTransaction<T>(c: ShareClient, fn: (tx: DbTransaction) => Promise<T>) {
  const run = (tx: DbTransaction) => asPropagation(() => fn(tx));
  return "$transaction" in c ? (c as Db).$transaction(run, { timeout: 30_000 }) : run(c);
}

async function groupsOfTrips(c: DbTransaction, tripIds: (string | null)[]) {
  const ids = [...new Set(tripIds.filter((t): t is string => t !== null))];
  if (ids.length === 0) return new Map<string, string | null>();
  const trips = await c.trip.findMany({
    where: { id: { in: ids } },
    select: { id: true, shareGroupId: true },
  });
  return new Map(trips.map((t) => [t.id, t.shareGroupId]));
}

async function snapshotsWith(
  c: DbTransaction,
  entity: ShareEntity,
  ids: readonly string[]
): Promise<Map<string, ShareSnapshot>> {
  if (ids.length === 0) return new Map();
  const rows = await ADAPTERS[entity].load(c, ids);
  const groups = await groupsOfTrips(
    c,
    rows.map((r) => r.tripId)
  );
  return new Map(
    rows.map((r) => [
      r.id,
      { ...r, entity, groupId: r.tripId ? (groups.get(r.tripId) ?? null) : null },
    ])
  );
}

/** The entries as they are now — taken BEFORE a write, handed to propagation after it. */
export async function shareSnapshots(
  c: ShareClient,
  entity: ShareEntity,
  ids: readonly string[]
): Promise<Map<string, ShareSnapshot>> {
  if (isPropagating() || ids.length === 0) return new Map();
  return snapshotsWith(c as DbTransaction, entity, ids);
}

export async function shareSnapshot(
  c: ShareClient,
  entity: ShareEntity,
  id: string
): Promise<ShareSnapshot | null> {
  return (await shareSnapshots(c, entity, [id])).get(id) ?? null;
}

interface NoticeInput {
  recipient: MemberTrip;
  groupId: string;
  actorId: string;
  kind: "created" | "updated" | "deleted";
  entity: ShareEntity;
  shareKey: string;
  before?: Prisma.InputJsonObject;
  after: Prisma.InputJsonObject;
}

async function notice(c: DbTransaction, n: NoticeInput): Promise<void> {
  await c.shareNotice.create({
    data: {
      userId: n.recipient.userId,
      groupId: n.groupId,
      actorId: n.actorId,
      kind: n.kind,
      entityType: n.entity,
      entityKey: n.shareKey,
      ...(n.before ? { before: n.before } : {}),
      after: n.after,
    },
  });
}

/** What every notice carries besides the values: what the entry is and where the copy lives. */
const meta = (row: SharedRow, recipient: MemberTrip, copyId: string) => ({
  label: row.label,
  tripId: recipient.id,
  entryId: copyId,
  zones: row.zones,
});

/** The copy `member` holds in their trip of the group, if any. */
const copyOf = (copies: SharedRow[], member: MemberTrip) =>
  copies.find((c) => c.userId === member.userId && c.tripId === member.id);

async function createCopies(
  c: DbTransaction,
  adapter: EntityAdapter,
  actorId: string,
  row: SharedRow,
  groupId: string
): Promise<void> {
  const key = randomUUID();
  await adapter.setKey(c, row.id, key);
  const source = { ...row, shareKey: key };
  for (const member of await receivingMembers(c, groupId, actorId)) {
    const copyId = await adapter.createCopy(c, source, member.userId, member.id);
    await notice(c, {
      recipient: member,
      groupId,
      actorId,
      kind: "created",
      entity: adapter.entity,
      shareKey: key,
      after: meta(source, member, copyId),
    });
  }
}

async function noticeRemoval(
  c: DbTransaction,
  adapter: EntityAdapter,
  actorId: string,
  row: SharedRow,
  groupId: string,
  reason: "deleted" | "movedOut"
): Promise<void> {
  const key = row.shareKey as string;
  const copies = await adapter.copiesOf(c, key);
  for (const member of await receivingMembers(c, groupId, actorId)) {
    const copy = copyOf(copies, member);
    if (!copy) continue;
    await notice(c, {
      recipient: member,
      groupId,
      actorId,
      kind: "deleted",
      entity: adapter.entity,
      shareKey: key,
      after: { ...meta(row, member, copy.id), reason },
    });
  }
}

async function updateCopies(
  c: DbTransaction,
  adapter: EntityAdapter,
  actorId: string,
  row: SharedRow,
  before: ShareSnapshot,
  groupId: string
): Promise<void> {
  const changed = changedKeys(before.facts, row.facts, adapter.fields);
  if (changed.length === 0) return;
  const copies = await adapter.copiesOf(c, row.shareKey as string);
  for (const member of await receivingMembers(c, groupId, actorId)) {
    const copy = copyOf(copies, member);
    if (!copy) continue;
    const keys = changed.filter((k) => !sameFact(copy.facts[k], row.facts[k]));
    if (keys.length === 0) continue;
    await adapter.apply(c, copy, row.facts, keys);
    await notice(c, {
      recipient: member,
      groupId,
      actorId,
      kind: "updated",
      entity: adapter.entity,
      shareKey: row.shareKey as string,
      before: { facts: jsonSubset(copy.facts, keys), zones: copy.zones },
      after: { ...meta(row, member, copy.id), facts: jsonSubset(row.facts, keys) },
    });
  }
}

/** The group a keyed entry's copies sit in, when the caller had no snapshot. */
async function groupOfCopies(c: DbTransaction, adapter: EntityAdapter, row: SharedRow) {
  const copies = (await adapter.copiesOf(c, row.shareKey as string)).filter(
    (r) => r.userId !== row.userId
  );
  const groups = await groupsOfTrips(
    c,
    copies.map((r) => r.tripId)
  );
  return [...groups.values()].find((g): g is string => g !== null) ?? null;
}

async function reconcile(
  c: DbTransaction,
  adapter: EntityAdapter,
  actorId: string,
  row: SharedRow,
  groupId: string | null,
  before: ShareSnapshot | null | undefined
): Promise<void> {
  if (!row.shareKey) {
    if (groupId && !row.excluded) await createCopies(c, adapter, actorId, row, groupId);
    return;
  }
  const oldGroup = before ? before.groupId : await groupOfCopies(c, adapter, row);
  const moved = before ? before.tripId !== row.tripId : oldGroup !== groupId;
  if (groupId && !moved) {
    if (before) await updateCopies(c, adapter, actorId, row, before, groupId);
    return;
  }
  if (oldGroup) await noticeRemoval(c, adapter, actorId, row, oldGroup, "movedOut");
  await adapter.setKey(c, row.id, null);
  if (groupId && !row.excluded) {
    await createCopies(c, adapter, actorId, { ...row, shareKey: null }, groupId);
  }
}

/**
 * Propagate the writes `actorId` just made to `ids`. `before` holds the
 * snapshots taken before the write (`shareSnapshots`); without one an entry
 * is only checked for having entered or left a shared trip. Rows that are not
 * the actor's own are ignored — a member's write never reaches into another
 * account except through its own group's copies.
 */
export async function propagateWrites(
  c: ShareClient,
  actorId: string,
  entity: ShareEntity,
  ids: readonly string[],
  before?: Map<string, ShareSnapshot>
): Promise<void> {
  if (isPropagating() || ids.length === 0) return;
  await inTransaction(c, async (tx) => {
    const adapter = ADAPTERS[entity];
    const rows = (await adapter.load(tx, ids)).filter((r) => r.userId === actorId);
    const groups = await groupsOfTrips(
      tx,
      rows.map((r) => r.tripId)
    );
    for (const row of rows) {
      const groupId = row.tripId ? (groups.get(row.tripId) ?? null) : null;
      if (!groupId && !row.shareKey) continue;
      await reconcile(tx, adapter, actorId, row, groupId, before?.get(row.id));
    }
  });
}

export async function propagateWrite(
  c: ShareClient,
  actorId: string,
  entity: ShareEntity,
  id: string,
  before?: ShareSnapshot | null
): Promise<void> {
  const map = before ? new Map([[id, before]]) : undefined;
  await propagateWrites(c, actorId, entity, [id], map);
}

/** After a delete: the members holding a copy are told; their copies stay (decision 3). */
export async function propagateDeletes(
  c: ShareClient,
  actorId: string,
  gone: readonly (ShareSnapshot | null | undefined)[]
): Promise<void> {
  const keyed = gone.filter(
    (s): s is ShareSnapshot => !!s && !!s.shareKey && !!s.groupId && s.userId === actorId
  );
  if (isPropagating() || keyed.length === 0) return;
  await inTransaction(c, async (tx) => {
    for (const snap of keyed) {
      const adapter = ADAPTERS[snap.entity];
      await noticeRemoval(tx, adapter, actorId, snap, snap.groupId as string, "deleted");
    }
  });
}

export async function propagateDelete(
  c: ShareClient,
  actorId: string,
  gone: ShareSnapshot | null | undefined
): Promise<void> {
  await propagateDeletes(c, actorId, [gone]);
}
