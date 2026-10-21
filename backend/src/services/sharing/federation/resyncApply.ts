/**
 * The spoke takes the home's current state of a trip (spec 2026-10-20, Q4/Q5 catch-up of
 * 2026-10-21): an `entries` message marked `resync`, the answer to its own `resync` request.
 * Every entry here has passed the entry-author gate already (`serveEntries`).
 *
 * - An entry the person lacks is copied, as in a first delivery, and a `created` notice names who
 *   brought it in (from the roster).
 * - An entry the person holds is compared fact by fact (the advisory `status` aside):
 *   - identical → nothing written; open conflict notices on those facts close;
 *   - different, and exactly a change withheld from them before their yes to its author — the
 *     copy still holds what it held then (`TripShareWithheld`) and they have said yes since →
 *     written, with an `updated` notice naming that author;
 *   - different, withheld from someone they still have not said yes to → left as it is;
 *   - different otherwise (their own edit, a value a restore lost, a joined own entry) → never
 *     overwritten: a `conflict` notice with both values, one per entry and facts
 *     (`recordConflict`), so a repeated resync adds none.
 *   An entry with a change of the person's own still on its way to the home is left alone: that
 *   change settles there and comes back as usual.
 */
import type { DbTransaction } from "../../../db";
import { ADAPTERS, type SharedRow } from "../adapters";
import { copyInto, joinedMeta } from "../copyInto";
import { DERIVE } from "../deriveCopy";
import { jsonSubset, sameFact } from "../factValues";
import { heldKeys } from "../keyOps";
import type { MemberTrip } from "../members";
import { supersedeSatisfied } from "../pendingSupersede";
import { noticeMeta, recordEntryNotice } from "../propagate";
import { SHARE_ENTITIES, type ShareEntity } from "../shareTypes";
import { restatusTrips } from "../../trip/restatusTrips";
import { recordConflict, settleConflicts } from "./conflicts";
import type { ChangeAuthor } from "./outbound";
import { mayReach } from "./roster";
import { lockCopy } from "./rowLock";
import { forgetWithheld, heldValue, withheldOf } from "./withheld";

type RemoteAuthor = Extract<ChangeAuthor, { kind: "remote" }>;

/** The person here an `entries` message is for, with the pairing it came through. */
export interface ResyncRecipient {
  userId: string;
  tripId: string;
  /** The home member's roster ref (this pairing's other side). */
  pairingRef: string;
  /** The person's own roster ref, once the home sent a roster. */
  ownRef: string | null;
  pairing: { id: string; displayName: string; origin: string };
}

interface ResyncInput {
  groupId: string;
  /** The home's origin: the server the state came from. */
  origin: string;
  recipient: ResyncRecipient;
  rows: readonly { entity: ShareEntity; row: SharedRow }[];
  /** Who brought each entry in, by roster ref (the message's `authors`). */
  authorOf: ReadonlyMap<string, string>;
}

const pairingAuthor = (r: ResyncRecipient): RemoteAuthor => ({
  kind: "remote",
  pairingId: r.pairing.id,
  displayName: r.pairing.displayName,
  origin: r.pairing.origin,
  ref: r.pairingRef,
});

/** A roster ref as an author: the pairing itself, or the name the roster holds for it. */
async function rosterAuthor(
  tx: DbTransaction,
  input: ResyncInput,
  ref: string | undefined
): Promise<RemoteAuthor> {
  const { recipient, groupId, origin } = input;
  if (!ref || ref === recipient.pairingRef) return pairingAuthor(recipient);
  const entry = await tx.tripShareRosterEntry.findUnique({
    where: { groupId_ref: { groupId, ref } },
  });
  if (!entry) return pairingAuthor(recipient);
  return {
    kind: "remote",
    pairingId: null,
    displayName: entry.displayName,
    origin: entry.origin,
    ref,
    ...(entry.origin !== origin ? { via: origin } : {}),
  };
}

/** A change of the person's own to this entry still waits in the outbox towards the home. */
async function ownChangeOnTheWay(tx: DbTransaction, input: ResyncInput, shareKey: string) {
  const waiting = await tx.tripShareOutbox.count({
    where: {
      groupId: input.groupId,
      peerOrigin: input.origin,
      parkedAt: null,
      OR: [
        { kind: "fact-update", payload: { path: ["shareKey"], equals: shareKey } },
        { kind: "entry-create", payload: { path: ["entry", "shareKey"], equals: shareKey } },
      ],
    },
  });
  return waiting > 0;
}

interface Verdict {
  apply: string[];
  conflict: string[];
  /** Who the facts written are by: the author of the first withheld change applied. */
  authorRef: string | null;
}

/** Per differing fact: written (a withheld change now agreed to), a conflict, or left. */
async function judge(
  tx: DbTransaction,
  input: ResyncInput,
  copy: SharedRow,
  differing: readonly string[]
): Promise<Verdict> {
  const { groupId, recipient } = input;
  const withheld = await withheldOf(tx, groupId, recipient.userId, copy.shareKey as string);
  const verdict: Verdict = { apply: [], conflict: [], authorRef: null };
  for (const key of differing) {
    const ws = withheld.filter((w) => w.field === key);
    if (ws.length === 0) {
      verdict.conflict.push(key);
      continue;
    }
    const agreed = await Promise.all(
      ws.map((w) => mayReach(tx, groupId, recipient.userId, { pairingId: null, ref: w.ref }))
    );
    // Still withheld from someone the person has not said yes to: theirs to decide later.
    if (!agreed.every(Boolean)) continue;
    const untouched = ws.find((w) => sameFact(copy.facts[key], heldValue(w.held)));
    if (untouched) {
      verdict.apply.push(key);
      verdict.authorRef ??= untouched.ref;
    } else verdict.conflict.push(key);
  }
  return verdict;
}

async function writeAgreed(
  tx: DbTransaction,
  input: ResyncInput,
  entity: ShareEntity,
  copy: SharedRow,
  incoming: SharedRow,
  verdict: Verdict
): Promise<void> {
  const { recipient } = input;
  const adapter = ADAPTERS[entity];
  await adapter.apply(tx, copy, incoming.facts, verdict.apply, copy.facts);
  await DERIVE[entity](tx, copy.id, recipient.userId);
  const [applied] = await adapter.load(tx, [copy.id]);
  const member: MemberTrip = { id: recipient.tripId, userId: recipient.userId };
  const author = await rosterAuthor(tx, input, verdict.authorRef ?? undefined);
  const noticeId = await recordEntryNotice(tx, {
    recipient: member,
    groupId: input.groupId,
    author,
    kind: "updated",
    entity,
    shareKey: copy.shareKey as string,
    before: { facts: jsonSubset(copy.facts, verdict.apply), zones: copy.zones },
    after: {
      ...noticeMeta(applied, member, copy.id),
      facts: jsonSubset(applied.facts, verdict.apply),
    },
  });
  if (entity === "flight")
    await supersedeSatisfied(tx, copy.id, { noticeId, actorId: `remote:${author.origin}` });
}

/** One entry the person holds: compared, and written only where that is provably theirs to get. */
async function refreshHeld(
  tx: DbTransaction,
  input: ResyncInput,
  entity: ShareEntity,
  incoming: SharedRow
): Promise<void> {
  const { recipient, groupId } = input;
  const key = incoming.shareKey as string;
  const adapter = ADAPTERS[entity];
  const found = (await adapter.copiesOf(tx, key, groupId)).find(
    (r) => r.userId === recipient.userId && r.tripId === recipient.tripId
  );
  if (!found) return;
  // Held from the comparison to the write, as for a received change (F-S4d review).
  await lockCopy(tx, entity, found.id);
  const [copy] = await adapter.load(tx, [found.id]);
  if (!copy) return;
  const keys = Object.keys(incoming.facts).filter((k) => k !== "status");
  const differing = keys.filter((k) => !sameFact(copy.facts[k], incoming.facts[k]));
  const equal = keys.filter((k) => !differing.includes(k));
  await settleConflicts(tx, recipient.userId, groupId, key, equal);
  await forgetWithheld(tx, groupId, recipient.userId, key, equal);
  if (differing.length === 0) return;
  if (await ownChangeOnTheWay(tx, input, key)) return;
  const verdict = await judge(tx, input, copy, differing);
  if (verdict.apply.length > 0) await writeAgreed(tx, input, entity, copy, incoming, verdict);
  if (verdict.conflict.length > 0)
    await recordConflict(tx, {
      recipient: { id: recipient.tripId, userId: recipient.userId },
      groupId,
      author: pairingAuthor(recipient),
      entity,
      copy,
      theirs: incoming.facts,
      keys: verdict.conflict,
    });
  await forgetWithheld(tx, groupId, recipient.userId, key, [...verdict.apply, ...verdict.conflict]);
}

/** Apply one resync message's entries for one person here, in registry order (stops last). */
export async function applyResync(tx: DbTransaction, input: ResyncInput): Promise<void> {
  const { recipient } = input;
  const member: MemberTrip = { id: recipient.tripId, userId: recipient.userId };
  for (const entity of SHARE_ENTITIES) {
    const ofType = input.rows.filter((r) => r.entity === entity);
    if (ofType.length === 0) continue;
    const held = await heldKeys(
      tx,
      entity,
      recipient.userId,
      recipient.tripId,
      ofType.map((r) => r.row.shareKey as string)
    );
    for (const { row } of ofType) {
      const key = row.shareKey as string;
      if (held.has(key)) {
        await refreshHeld(tx, input, entity, row);
        continue;
      }
      const copy = await copyInto(tx, entity, row, recipient);
      if (!copy) continue;
      const ref = input.authorOf.get(key);
      // The person's own entry coming back after a restore is not news to them.
      if (ref && ref === recipient.ownRef) continue;
      const [loaded] = await ADAPTERS[entity].load(tx, [copy.id]);
      await recordEntryNotice(tx, {
        recipient: member,
        groupId: input.groupId,
        author: await rosterAuthor(tx, input, ref),
        kind: "created",
        entity,
        shareKey: key,
        after: { ...noticeMeta(loaded, member, copy.id), ...joinedMeta(copy) },
      });
    }
  }
  await restatusTrips([recipient.tripId], tx);
}
