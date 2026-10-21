import { randomUUID } from "crypto";

import type { Db, DbTransaction } from "../../db";
import type { Prisma } from "../../prisma";
import { ADAPTERS, type EntityAdapter, type ShareEntity, type SharedRow } from "./adapters";
import { copyInto, joinedMeta } from "./copyInto";
import { changedKeys, jsonSubset, sameFact } from "./factValues";
import { restatusTrips } from "../trip/restatusTrips";
import { DERIVE } from "./deriveCopy";
import { supersedeSatisfied } from "./pendingSupersede";
import { receivingMembers, type MemberTrip } from "./members";
import { asPropagation, isPropagating } from "./propagationGuard";
import {
  queueEntryCreate,
  queueEntryRemoved,
  queueFactUpdate,
  type ChangeAuthor,
  type Spread,
} from "./federation/outbound";
import { reachableBy, recordEntryAuthor } from "./federation/roster";

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
 *
 * People on other servers (spec 2026-10-20, phase F-S4d) get the same three
 * kinds of change as messages in the outbox (`federation/outbound.ts`),
 * written in the same transaction — through the writer's pairings and those of
 * every member here the change reached. A change that arrives from another
 * server spreads here through the same functions (`spreadUpdate`, …), naming
 * that person, and never goes back to the server it came from.
 */

export type ShareClient = Db | DbTransaction;

/** An entry as it was, with the group its trip belonged to then. */
export interface ShareSnapshot extends SharedRow {
  entity: ShareEntity;
  groupId: string | null;
}

/** A write and its propagation share one transaction; the copies of a big trip need more than Prisma's 5 s default. */
export const SHARE_TX_TIMEOUT_MS = 30_000;

async function inTransaction<T>(c: ShareClient, fn: (tx: DbTransaction) => Promise<T>) {
  const run = (tx: DbTransaction) => asPropagation(() => fn(tx));
  return "$transaction" in c
    ? (c as Db).$transaction(run, { timeout: SHARE_TX_TIMEOUT_MS })
    : run(c);
}

/** trip id → its share group; with `ownerId`, only trips that are that user's own. */
async function groupsOfTrips(c: DbTransaction, tripIds: (string | null)[], ownerId?: string) {
  const ids = [...new Set(tripIds.filter((t): t is string => t !== null))];
  if (ids.length === 0) return new Map<string, string | null>();
  const trips = await c.trip.findMany({
    where: { id: { in: ids }, ...(ownerId ? { userId: ownerId } : {}) },
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
  const tripIds = [...new Set(rows.flatMap((r) => (r.tripId ? [r.tripId] : [])))];
  const trips = await c.trip.findMany({
    where: { id: { in: tripIds } },
    select: { id: true, userId: true, shareGroupId: true },
  });
  const byId = new Map(trips.map((t) => [t.id, t]));
  // A group counts only through the row owner's OWN trip.
  const groupOf = (r: SharedRow) => {
    const trip = r.tripId ? byId.get(r.tripId) : undefined;
    return trip && trip.userId === r.userId ? trip.shareGroupId : null;
  };
  return new Map(rows.map((r) => [r.id, { ...r, entity, groupId: groupOf(r) }]));
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

export interface NoticeInput {
  recipient: MemberTrip;
  groupId: string;
  /** Who made the change: an account here, or (`author`) a person on another server. */
  actorId?: string | null;
  author?: ChangeAuthor;
  kind: "created" | "updated" | "deleted" | "conflict";
  entity: ShareEntity;
  shareKey: string;
  before?: Prisma.InputJsonObject;
  after: Prisma.InputJsonObject;
}

/** The notice columns naming who made a change; a remote author is also kept by name. */
export function authorColumns(author: ChangeAuthor | undefined, actorId?: string | null) {
  if (!author || author.kind === "user") return { actorId: author?.id ?? actorId ?? null };
  return {
    remoteActorId: author.pairingId,
    remoteAuthor: {
      displayName: author.displayName,
      origin: author.origin,
      ...(author.via ? { via: author.via } : {}),
    },
  };
}

export async function recordEntryNotice(c: DbTransaction, n: NoticeInput): Promise<string> {
  const { remoteAuthor, ...actor } = authorColumns(n.author, n.actorId);
  const row = await c.shareNotice.create({
    data: {
      userId: n.recipient.userId,
      groupId: n.groupId,
      ...actor,
      kind: n.kind,
      entityType: n.entity,
      entityKey: n.shareKey,
      ...(n.before ? { before: n.before } : {}),
      // The name travels with the notice: a relayed change names someone no pairing here knows.
      after: remoteAuthor ? { ...n.after, remoteActor: remoteAuthor } : n.after,
    },
    select: { id: true },
  });
  return row.id;
}

/** What every notice carries besides the values: what the entry is and where the copy lives. */
export const noticeMeta = (row: SharedRow, recipient: MemberTrip, copyId: string) => ({
  label: row.label,
  tripId: recipient.id,
  entryId: copyId,
  zones: row.zones,
});

/** The copy `member` holds in their trip of the group, if any. */
const copyOf = (copies: SharedRow[], member: MemberTrip) =>
  copies.find((c) => c.userId === member.userId && c.tripId === member.id);

/** A change made here by `actorId`: their consents decide, their name is on the notices. */
const byUser = (actorId: string, groupId: string): Spread => ({
  groupId,
  author: { kind: "user", id: actorId },
  via: [actorId],
  fromOrigin: null,
});

/** The notice columns of a spread's author. */
const authorOf = (spread: Spread) =>
  spread.author.kind === "user" ? { actorId: spread.author.id } : { author: spread.author };

/** Whose consents decide who receives here: the first of `via` (the writer, or the person reached). */
const deciderOf = (spread: Spread) => spread.via[0];

/**
 * The members here a spread reaches: those the decider's consents reach — and, for a change by a
 * person on another server, only those who said yes to that person (F-S4e roster) or are paired
 * with them. A newcomer's change reaches a member only after that member's consent.
 */
async function reachedHere(c: DbTransaction, spread: Spread): Promise<MemberTrip[]> {
  const members = await receivingMembers(c, spread.groupId, deciderOf(spread));
  if (spread.author.kind === "user") return members;
  return reachableBy(c, spread.groupId, members, spread.author);
}

async function createCopies(
  c: DbTransaction,
  adapter: EntityAdapter,
  actorId: string,
  row: SharedRow,
  groupId: string
): Promise<void> {
  const key = randomUUID();
  await adapter.setKey(c, row.id, key);
  await spreadCreate(c, adapter, byUser(actorId, groupId), { ...row, shareKey: key });
}

/** A keyed entry is new in the group's trip: a copy for every receiving member, here and away. */
export async function spreadCreate(
  c: DbTransaction,
  adapter: EntityAdapter,
  spread: Spread,
  source: SharedRow
): Promise<void> {
  const key = source.shareKey as string;
  // Who brought it in, for a resend across servers after a restore (F-S4e review).
  await recordEntryAuthor(c, spread.groupId, key, spread.author);
  const reached: string[] = [];
  for (const member of await reachedHere(c, spread)) {
    const copy = await copyInto(c, adapter.entity, source, {
      userId: member.userId,
      tripId: member.id,
    });
    // Their own entry sits in another shared trip: left there, nothing to tell.
    if (!copy) continue;
    reached.push(member.userId);
    await restatusTrips([member.id], c);
    await recordEntryNotice(c, {
      recipient: member,
      groupId: spread.groupId,
      ...authorOf(spread),
      kind: "created",
      entity: adapter.entity,
      shareKey: key,
      after: { ...noticeMeta(source, member, copy.id), ...joinedMeta(copy) },
    });
  }
  await queueEntryCreate(
    c,
    { ...spread, via: [...spread.via, ...reached] },
    adapter.entity,
    source
  );
}

async function noticeRemoval(
  c: DbTransaction,
  adapter: EntityAdapter,
  actorId: string,
  row: SharedRow,
  groupId: string,
  reason: "deleted" | "movedOut"
): Promise<void> {
  await spreadRemoval(c, adapter, byUser(actorId, groupId), row, reason);
}

/** An entry was deleted or moved out: everyone holding a copy is told, here and away. */
export async function spreadRemoval(
  c: DbTransaction,
  adapter: EntityAdapter,
  spread: Spread,
  row: SharedRow,
  reason: "deleted" | "movedOut"
): Promise<void> {
  const key = row.shareKey as string;
  const copies = await adapter.copiesOf(c, key, spread.groupId);
  const reached: string[] = [];
  for (const member of await reachedHere(c, spread)) {
    const copy = copyOf(copies, member);
    if (!copy) continue;
    reached.push(member.userId);
    await recordEntryNotice(c, {
      recipient: member,
      groupId: spread.groupId,
      ...authorOf(spread),
      kind: "deleted",
      entity: adapter.entity,
      shareKey: key,
      after: { ...noticeMeta(row, member, copy.id), reason },
    });
  }
  await queueEntryRemoved(
    c,
    { ...spread, via: [...spread.via, ...reached] },
    adapter.entity,
    row,
    reason
  );
}

async function updateCopies(
  c: DbTransaction,
  adapter: EntityAdapter,
  actorId: string,
  row: SharedRow,
  before: ShareSnapshot,
  groupId: string
): Promise<void> {
  await spreadUpdate(c, adapter, byUser(actorId, groupId), row, before.facts);
}

/**
 * The facts of a keyed entry changed (`before` → `row`): every receiving member's copy that
 * differs takes them, here (last writer wins, as ever locally) and — as a `fact-update` with the
 * values held before — on other servers.
 */
export async function spreadUpdate(
  c: DbTransaction,
  adapter: EntityAdapter,
  spread: Spread,
  row: SharedRow,
  before: SharedRow["facts"]
): Promise<void> {
  const changed = changedKeys(before, row.facts, adapter.fields);
  if (changed.length === 0) return;
  const { groupId } = spread;
  const copies = await adapter.copiesOf(c, row.shareKey as string, groupId);
  const reached: string[] = [];
  for (const member of await reachedHere(c, spread)) {
    const copy = copyOf(copies, member);
    if (!copy) continue;
    // Reached even when its copy already agrees: its pairings carry the change on all the same.
    reached.push(member.userId);
    const keys = changed.filter((k) => !sameFact(copy.facts[k], row.facts[k]));
    if (keys.length === 0) continue;
    await adapter.apply(c, copy, row.facts, keys, before);
    await DERIVE[adapter.entity](c, copy.id, member.userId);
    // What the copy holds NOW, not what the sharer sent: a house written field
    // by field, a cruise that kept a member's own call, a status re-derived
    // from the dates all differ from the sharer's values, and an undo compares
    // against this side — recording the sharer's would refuse every such undo.
    const [applied] = await adapter.load(c, [copy.id]);
    // The trip's status caches its entries' dates; the route that made the
    // change re-derives only the writer's own trip.
    await restatusTrips([member.id], c);
    const noticeId = await recordEntryNotice(c, {
      recipient: member,
      groupId,
      ...authorOf(spread),
      kind: "updated",
      entity: adapter.entity,
      shareKey: row.shareKey as string,
      before: { facts: jsonSubset(copy.facts, keys), zones: copy.zones },
      after: {
        ...noticeMeta(row, member, copy.id),
        facts: jsonSubset((applied ?? row).facts, keys),
      },
    });
    // Flights are the one type with provider suggestions (PendingFlightUpdate).
    if (adapter.entity === "flight")
      await supersedeSatisfied(c, copy.id, { noticeId, actorId: supersedeActor(spread) });
  }
  await queueFactUpdate(
    c,
    { ...spread, via: [...spread.via, ...reached] },
    adapter.entity,
    row,
    before,
    changed
  );
}

/** What a superseded provider suggestion records as its cause. */
const supersedeActor = (spread: Spread) =>
  spread.author.kind === "user" ? spread.author.id : `remote:${spread.author.origin}`;

/**
 * The group a keyed entry's copies sit in, when the caller had no snapshot.
 * Looked for only among the groups the actor is a member of — never by the
 * key alone across the database.
 */
async function groupOfCopies(c: DbTransaction, adapter: EntityAdapter, row: SharedRow) {
  const actorTrips = await c.trip.findMany({
    where: { userId: row.userId, shareGroupId: { not: null } },
    select: { shareGroupId: true },
  });
  for (const groupId of new Set(actorTrips.map((t) => t.shareGroupId as string))) {
    const copies = await adapter.copiesOf(c, row.shareKey as string, groupId);
    if (copies.some((r) => r.userId !== row.userId)) return groupId;
  }
  return null;
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
      rows.map((r) => r.tripId),
      actorId
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
