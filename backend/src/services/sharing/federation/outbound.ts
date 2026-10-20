/**
 * Propagation leaves this server (spec 2026-10-20 §5, F5, F7, phase F-S4d): a change to a shared
 * trip is written to the outbox — inside the transaction of the write it describes, never with a
 * network call there — once per person on another server who receives it. The delivery
 * scheduler (`outbox.ts`) sends it later, in order.
 *
 * Who receives: `receivingRemotes()` through the pairings of the writer AND of every member here
 * the change reached (F5: the home relays — a member who never paired with that person reaches
 * them through the member who did). A change that came from another server is never sent back
 * there: that server fans out to its own members itself.
 *
 * One row per remote member, not per server: a message names one pairing (`from`, `to`), and the
 * receiving server copies into that person's trip only. Two people on one server share the
 * server's stream numbering, so they still arrive in order.
 */
import type { DbTransaction } from "../../../db";
import type { Prisma } from "../../../prisma";
import logger from "../../../utils/logger";
import { sameFact, type FactRecord } from "../factValues";
import { receivingRemotes, type RemoteMemberRef } from "../members";
import { PERSON_SELECT, toPerson } from "../people";
import type { SharedRow } from "../adapters";
import type { ShareEntity } from "../shareTypes";
import type { ChangeActor, OutboxKind } from "../../../schemas/tripSharePeer";
import { kickDelivery } from "./deliveryKick";
import { BODY_BUDGET, wireBytes } from "./transport";
import { toWireEntries, wireFactsOf, wireKeyOf } from "./wire/encode";

/** Who a change is by: an account here, or a person on another server (named as theirs names them). */
export type ChangeAuthor =
  | { kind: "user"; id: string }
  | {
      kind: "remote";
      pairingId: string | null;
      displayName: string;
      origin: string;
      /** The server that relayed it here, when that is not the author's own (the home, F5). */
      via?: string;
    };

/** Where a change goes from here, and whose notices name whom. */
export interface Spread {
  groupId: string;
  author: ChangeAuthor;
  /** The members here whose pairings carry it on: the writer, and every member it reached. */
  via: readonly string[];
  /** The server the change came from, if any: nothing goes back there. */
  fromOrigin: string | null;
}

/** Room left in a message for its header and the envelope. */
const ROOM = BODY_BUDGET["fact-update"] - 8_192;
/** Lines on the map: the one kind of fact that can outgrow a message on its own. */
const GEOMETRY_FACTS = new Set(["actualRoute", "geometry"]);

async function targets(c: DbTransaction, spread: Spread): Promise<RemoteMemberRef[]> {
  const seen = new Map<string, RemoteMemberRef>();
  for (const userId of new Set(spread.via)) {
    for (const member of await receivingRemotes(c, spread.groupId, userId, { queueable: true })) {
      if (member.origin !== spread.fromOrigin) seen.set(member.id, member);
    }
  }
  return [...seen.values()];
}

/** The author as the wire names them; a local author's origin is this server's, added on send. */
async function wireActor(c: DbTransaction, author: ChangeAuthor): Promise<ChangeActor> {
  if (author.kind === "remote") return { displayName: author.displayName, origin: author.origin };
  const user = await c.user.findUnique({ where: { id: author.id }, select: PERSON_SELECT });
  return { displayName: user ? toPerson(user).displayName : "?" };
}

/**
 * Queue one message per receiving remote member. `make` builds the body only when someone
 * receives it: most writes to a shared trip have nobody on another server.
 */
async function queue(
  c: DbTransaction,
  spread: Spread,
  kind: Exclude<OutboxKind, "entries">,
  label: string | null,
  make: () => Promise<Record<string, unknown> | null>
): Promise<number> {
  const to = await targets(c, spread);
  if (to.length === 0) return 0;
  const body = await make();
  if (!body) return 0;
  const actor = await wireActor(c, spread.author);
  for (const member of to) {
    await c.tripShareOutbox.create({
      data: {
        groupId: spread.groupId,
        memberId: member.id,
        peerOrigin: member.origin,
        kind,
        label: label || null,
        payload: {
          ...body,
          from: member.localChannel,
          to: member.channel,
          actor,
        } as Prisma.InputJsonValue,
      },
    });
  }
  kickDelivery();
  return to.length;
}

const tooLarge = (value: unknown) => wireBytes(value) > ROOM;

/**
 * A keyed entry's facts changed here (`keys`, local fact names): each change travels with the
 * value this server held before it (F6), both in wire form. A reference is sent by its natural
 * key, so the receiver compares and resolves it against its own catalogue.
 */
export async function queueFactUpdate(
  c: DbTransaction,
  spread: Spread,
  entity: ShareEntity,
  row: SharedRow,
  before: FactRecord,
  keys: readonly string[]
): Promise<void> {
  const shareKey = row.shareKey;
  if (!shareKey || keys.length === 0) return;
  await queue(c, spread, "fact-update", row.label, async () => {
    const [b, a] = await wireFactsOf(c, entity, [before, row.facts]);
    let changes = [...new Set(keys.map((k) => wireKeyOf(entity, k)))]
      .filter((field) => !sameFact(b[field], a[field]))
      .map((field) => ({ field, before: b[field], after: a[field] }));
    // A line too long for one message travels without it — a stated loss (spec §4), logged.
    if (tooLarge(changes)) changes = changes.filter((ch) => !GEOMETRY_FACTS.has(ch.field));
    if (changes.length === 0) return null;
    // Still too large: queued all the same, so the delivery parks it as `too-large` and the trip
    // page names the entry — a change dropped here would vanish without a word.
    if (tooLarge(changes))
      logger.warn(
        { operation: "trip_share_update_too_large", entity, groupId: spread.groupId },
        "A change is too large for any message; it will be parked, not sent"
      );
    return { entity, shareKey, changes };
  });
}

/** A new keyed entry in the shared trip: sent as one wire entry, as the first copy sent it. */
export async function queueEntryCreate(
  c: DbTransaction,
  spread: Spread,
  entity: ShareEntity,
  row: SharedRow
): Promise<void> {
  if (!row.shareKey || row.excluded) return;
  await queue(c, spread, "entry-create", row.label, async () => {
    const [entry] = await toWireEntries(c, entity, [row]);
    if (!entry) return null;
    if (tooLarge(entry))
      logger.warn(
        { operation: "trip_share_entry_too_large", entity, groupId: spread.groupId },
        "An entry is too large for any message; it will be parked, not sent"
      );
    return { entry };
  });
}

/** An entry was deleted or moved out: the others are told; their copies stay (decision 3). */
export async function queueEntryRemoved(
  c: DbTransaction,
  spread: Spread,
  entity: ShareEntity,
  row: SharedRow,
  reason: "deleted" | "movedOut"
): Promise<void> {
  const shareKey = row.shareKey;
  if (!shareKey) return;
  await queue(c, spread, "entry-removed", row.label, async () => ({ entity, shareKey, reason }));
}
