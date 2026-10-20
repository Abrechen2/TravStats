/**
 * A change arrives from another server (spec 2026-10-20 §4, §5, F5, F6, phase F-S4d):
 * `fact-update`, `entry-create`, `entry-removed`.
 *
 * Each is resolved first to the group by (sending origin, `groupRef`) — a group whose home is
 * that server, or this server's own group with a member there — then to the pairing it names
 * (`from`, `to`), whose member must still receive and whose consent must still be accepted;
 * anything else is `not-member` / `consent` and writes nothing. The stream's seq is taken before
 * any write, so a message applies wholly or not at all (`streams.ts`).
 *
 * Applied inside the propagation guard (nothing echoes back through the ordinary propagate
 * calls), then spread on explicitly: to the members here the person's consents reach, and from a
 * home on to its other spokes — never back to the server it came from.
 *
 * - **fact-update**: a fact is written only where the copy still holds `before` (F6); one the
 *   copy already holds is settled; one that moved is a conflict — a notice here, and the value
 *   held is named in the answer so the sender's person gets theirs. Nothing is swapped.
 * - **entry-create**: copied through the one copy path, own-entry join included; a key already
 *   held copies nothing (a repeat).
 * - **entry-removed**: a notice only; the copy stays, as locally.
 */
import type { DbTransaction } from "../../../db";
import { ADAPTERS, type ShareEntity } from "../adapters";
import { SHARE_TYPES } from "../shareTypes";
import { copyInto, joinedMeta } from "../copyInto";
import { DERIVE } from "../deriveCopy";
import { jsonSubset, sameFact } from "../factValues";
import { heldKeys } from "../keyOps";
import { acceptedParties, type MemberTrip } from "../members";
import { supersedeSatisfied } from "../pendingSupersede";
import { asPropagation } from "../propagationGuard";
import {
  noticeMeta,
  recordEntryNotice,
  spreadCreate,
  spreadRemoval,
  spreadUpdate,
} from "../propagate";
import { restatusTrips } from "../../trip/restatusTrips";
import type {
  AckConflict,
  EntryCreateMessage,
  EntryRemovedMessage,
  FactUpdateMessage,
  PropagationMessage,
  TripShareAck,
} from "../../../schemas/tripSharePeer";
import { recordConflict, settleConflicts } from "./conflicts";
import { heldIdentity, namedReference, nameToWrite, sentIdentity } from "./refIdentity";
import type { ChangeAuthor, Spread } from "./outbound";
import { rejectWith, serveOnce, takeSeq } from "./streams";
import { fromWireEntries, fromWireFacts, localKeyOf, receivedStatus } from "./wire/decode";
import { wireFactsOf } from "./wire/encode";
import { ENTRY_SHAPES, type WireEntry } from "./wire/shapes";

/** A member here still takes messages while their delivery towards that server is held up. */
const RECEIVING = new Set(["active", "unreachable"]);

interface Sender {
  groupId: string;
  /** The person here the message is for, and their trip of the group. */
  recipient: MemberTrip;
  author: Extract<ChangeAuthor, { kind: "remote" }>;
  origin: string;
}

async function senderOf(
  tx: DbTransaction,
  origin: string,
  message: PropagationMessage
): Promise<Sender> {
  const group =
    (await tx.tripShareGroup.findFirst({
      where: { homeOrigin: origin, federatedRef: message.groupRef },
    })) ??
    (await tx.tripShareGroup.findFirst({
      where: { homeOrigin: null, federatedRef: message.groupRef },
    }));
  if (!group) throw rejectWith("not-member");
  const pairing = await tx.remoteShareAccount.findFirst({
    where: { origin, channel: message.from, localChannel: message.to },
  });
  if (!pairing) throw rejectWith("not-member");
  const member = await tx.tripShareRemoteMember.findUnique({
    where: { groupId_remoteId: { groupId: group.id, remoteId: pairing.id } },
  });
  const live =
    member &&
    (RECEIVING.has(member.state) || (member.state === "suspended" && member.stateReason === "off"));
  if (!live) throw rejectWith("not-member");
  const trip = await tx.trip.findFirst({
    where: { userId: pairing.userId, shareGroupId: group.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true },
  });
  if (!trip) throw rejectWith("not-member");
  const consenting = await acceptedParties(tx, { kind: "user", id: pairing.userId }, [
    { kind: "remote", id: pairing.id },
  ]);
  if (consenting.size === 0) throw rejectWith("consent");
  await takeSeq(tx, group.id, origin, message.seq);
  return {
    groupId: group.id,
    recipient: trip,
    origin,
    author: await authorOf(tx, origin, message, { ...group, pairing }),
  };
}

/**
 * Who a received change is by. The sending server's claim (`actor`) is believed only where it
 * can be checked at all: from the group's home (the hub relays for its spokes, F5), and only for
 * an origin this server knows as one of the group's remote members. Everything else — a spoke
 * naming someone else, a home naming a server that is not in the group — is attributed to the
 * sending pairing, under its own name: a peer cannot put words in another person's mouth here.
 */
async function authorOf(
  tx: DbTransaction,
  origin: string,
  message: PropagationMessage,
  group: {
    id: string;
    homeOrigin: string | null;
    pairing: { id: string; displayName: string; origin: string };
  }
): Promise<Sender["author"]> {
  const own = {
    kind: "remote" as const,
    pairingId: group.pairing.id,
    displayName: group.pairing.displayName,
    origin: group.pairing.origin,
  };
  if (group.homeOrigin !== origin) return own;
  const claimed = message.actor.origin ?? origin;
  const members = await tx.tripShareRemoteMember.findMany({
    where: { groupId: group.id },
    select: { remote: { select: { origin: true } } },
  });
  if (!members.some((m) => m.remote.origin === claimed)) return own;
  const self = claimed === origin && message.actor.displayName === group.pairing.displayName;
  return {
    kind: "remote",
    pairingId: self ? group.pairing.id : null,
    displayName: message.actor.displayName,
    origin: claimed,
    ...(claimed !== origin ? { via: origin } : {}),
  };
}

const onward = (s: Sender): Spread => ({
  groupId: s.groupId,
  author: s.author,
  via: [s.recipient.userId],
  fromOrigin: s.origin,
});

async function ownCopy(tx: DbTransaction, s: Sender, entity: ShareEntity, shareKey: string) {
  return (await ADAPTERS[entity].copiesOf(tx, shareKey, s.groupId)).find(
    (r) => r.userId === s.recipient.userId && r.tripId === s.recipient.id
  );
}

/** The changes' values on one side, parsed by their codecs and resolved against this catalogue. */
/** The changes' values on one side, parsed by their codecs (`wire`) and resolved here (`local`). */
async function sideOf(tx: DbTransaction, message: FactUpdateMessage, side: "before" | "after") {
  const shape = ENTRY_SHAPES[message.entity];
  const wire: Record<string, unknown> = Object.fromEntries(
    message.changes.map((ch) => [ch.field, shape[ch.field].wire.parse(ch[side])])
  );
  return { wire, local: await fromWireFacts(tx, message.entity, wire) };
}

async function applyFactUpdate(
  tx: DbTransaction,
  s: Sender,
  message: FactUpdateMessage
): Promise<AckConflict[]> {
  const { entity, shareKey } = message;
  const adapter = ADAPTERS[entity];
  // Their copy is gone (deleted, or moved out): nothing to write, nobody to tell.
  const found = await ownCopy(tx, s, entity, shareKey);
  if (!found) return [];
  // The row is held from the check to the write: a local save committed in between would
  // otherwise be overwritten without a conflict (F-S4d review). Read again under the lock, so
  // a save that committed before it is what `before` is compared with.
  await tx.$queryRawUnsafe(
    `SELECT 1 FROM "${SHARE_TYPES[entity].table}" WHERE id = $1 FOR UPDATE`,
    found.id
  );
  const [copy] = await adapter.load(tx, [found.id]);
  if (!copy) return [];
  const [sent, wanted] = await Promise.all([
    sideOf(tx, message, "before"),
    sideOf(tx, message, "after"),
  ]);
  const before = sent.local;
  const after = wanted.local;
  const apply: string[] = [];
  const settled: string[] = [];
  const conflicts: { field: string; key: string }[] = [];
  const values = { ...after };
  const changed = new Set(message.changes.map((ch) => localKeyOf(entity, ch.field)));
  for (const { field } of message.changes) {
    const key = localKeyOf(entity, field);
    const named = namedReference(entity, key);
    if (named) {
      // Compared by what it names, not by an id two misses share (F-S4d review).
      const held = heldIdentity(copy.facts, named);
      if (held === sentIdentity(after[key], wanted.wire[field])) settled.push(key);
      else if (held === sentIdentity(before[key], sent.wire[field])) {
        apply.push(key);
        const name = nameToWrite(
          named,
          copy.facts,
          after[key],
          sent.wire[field],
          wanted.wire[field]
        );
        // The sender's own change to the name fact, if any, is its own fact and wins.
        if (name.write && !changed.has(named.name)) {
          values[named.name] = name.value;
          apply.push(named.name);
        }
      } else conflicts.push({ field, key });
    } else if (key === "status") {
      // Advisory (rework D4): only whether it is a state no clock can produce crosses; this
      // server derives the rest, so there is nothing to compare.
      values.status = receivedStatus(entity, after.status);
      if (values.status !== receivedStatus(entity, copy.facts.status)) apply.push(key);
    } else if (sameFact(copy.facts[key], after[key])) settled.push(key);
    else if (sameFact(copy.facts[key], before[key])) apply.push(key);
    else conflicts.push({ field, key });
  }
  // Held already, or written now: a conflict an open notice showed on those facts is decided.
  await settleConflicts(tx, s.recipient.userId, s.groupId, shareKey, [...settled, ...apply]);
  if (apply.length > 0) {
    await adapter.apply(tx, copy, values, apply, { ...copy.facts, ...before });
    await DERIVE[entity](tx, copy.id, s.recipient.userId);
    const [applied] = await adapter.load(tx, [copy.id]);
    await restatusTrips([s.recipient.id], tx);
    const noticeId = await recordEntryNotice(tx, {
      recipient: s.recipient,
      groupId: s.groupId,
      author: s.author,
      kind: "updated",
      entity,
      shareKey,
      before: { facts: jsonSubset(copy.facts, apply), zones: copy.zones },
      after: {
        ...noticeMeta(applied, s.recipient, copy.id),
        facts: jsonSubset(applied.facts, apply),
      },
    });
    if (entity === "flight")
      await supersedeSatisfied(tx, copy.id, { noticeId, actorId: `remote:${s.author.origin}` });
    await spreadUpdate(tx, adapter, onward(s), applied, copy.facts);
  }
  if (conflicts.length === 0) return [];
  const keys = conflicts.map((c) => c.key);
  await recordConflict(tx, {
    recipient: s.recipient,
    groupId: s.groupId,
    author: s.author,
    entity,
    copy,
    theirs: after,
    keys,
  });
  const [held] = await wireFactsOf(tx, entity, [copy.facts]);
  return conflicts.map(({ field }) => ({
    field,
    held: (held[field] ?? null) as AckConflict["held"],
  }));
}

async function applyEntryCreate(tx: DbTransaction, s: Sender, message: EntryCreateMessage) {
  const [{ entity, row }] = await fromWireEntries(tx, [message.entry as WireEntry]);
  const key = row.shareKey as string;
  const held = await heldKeys(tx, entity, s.recipient.userId, s.recipient.id, [key]);
  if (held.has(key)) return;
  const copy = await copyInto(tx, entity, row, {
    userId: s.recipient.userId,
    tripId: s.recipient.id,
  });
  if (!copy) return;
  await restatusTrips([s.recipient.id], tx);
  const [loaded] = await ADAPTERS[entity].load(tx, [copy.id]);
  await recordEntryNotice(tx, {
    recipient: s.recipient,
    groupId: s.groupId,
    author: s.author,
    kind: "created",
    entity,
    shareKey: key,
    after: { ...noticeMeta(loaded, s.recipient, copy.id), ...joinedMeta(copy) },
  });
  await spreadCreate(tx, ADAPTERS[entity], onward(s), loaded);
}

async function applyEntryRemoved(tx: DbTransaction, s: Sender, message: EntryRemovedMessage) {
  const copy = await ownCopy(tx, s, message.entity, message.shareKey);
  if (!copy) return;
  await recordEntryNotice(tx, {
    recipient: s.recipient,
    groupId: s.groupId,
    author: s.author,
    kind: "deleted",
    entity: message.entity,
    shareKey: message.shareKey,
    after: { ...noticeMeta(copy, s.recipient, copy.id), reason: message.reason },
  });
  await spreadRemoval(tx, ADAPTERS[message.entity], onward(s), copy, message.reason);
}

/** Serve one propagation message from `origin`. */
export function servePropagation(
  origin: string,
  message: PropagationMessage
): Promise<TripShareAck> {
  return serveOnce(origin, message, async (tx) => {
    const s = await senderOf(tx, origin, message);
    return asPropagation(async () => {
      switch (message.kind) {
        case "fact-update": {
          const conflicts = await applyFactUpdate(tx, s, message);
          return conflicts.length > 0 ? { ack: { conflicts } } : undefined;
        }
        case "entry-create":
          await applyEntryCreate(tx, s, message);
          return undefined;
        case "entry-removed":
          await applyEntryRemoved(tx, s, message);
          return undefined;
      }
    });
  });
}
