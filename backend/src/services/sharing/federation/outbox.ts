/**
 * Delivery of the outbox (spec 2026-10-20 F7, §7, phase F-S4d). Rows are written inside the
 * transaction of the write they describe (`outbound.ts`, `entries.ts`); this sends them, run by
 * `jobs/tripShareDeliveryScheduler.ts` on an interval and when nudged.
 *
 * Per (group, peer) strictly in `position` order, numbered on the stream at send time
 * (`sendOnStream`: the seq moves only on the acknowledgement, a `gap` is resent once at the seq
 * the peer expects). The message id is the row's id on every attempt, so a message whose
 * answer was lost is answered from the peer's inbound table instead of being applied twice.
 *
 * Before each send the permission is asked again (F7): the member must still be one whose
 * messages queue and the consent must still be accepted — a queued row is a reference to a
 * permission that must still hold, and is deleted when it does not.
 *
 * Each outcome is the user's to see (§7), per remote member (`deliveryOf`):
 * - **acknowledged** — the row goes; a member shown unreachable or switched off is active again;
 *   facts the peer could not write (`ack.conflicts`) become a conflict notice here too (F6);
 * - **an error of one of the two servers** — this one's code or database (`local-error`), or the
 *   other's while applying it (`ack rejected: error` → `remote-error`): retried like a transport
 *   failure, but never shown as `unreachable`, because the other server did answer;
 * - **transport failure** — retried after 1 min, 5 min, 30 min, 2 h, 12 h, then daily, the rest
 *   of the stream waiting behind it (order is kept); 14 days after the first failure the member
 *   is `unreachable`. A 404 means the feature is off there (`suspended`, `off`); a pin this
 *   server's admin disabled is `suspended`, `peer-blocked`. The queue is kept in every case.
 * - **held** — a membership suspended here until its person confirms it again (restore, a
 *   blocked server, a re-pinned key; O9): the stream waits, nothing is sent or counted; a peer
 *   that holds ours answers `suspended`, and the message is retried as `suspended-there`;
 * - **refused** (`schema`, `not-member`, `consent`), or larger in UTF-8 bytes than its transport
 *   carries (`too-large`) — the row is parked with the reason, not retried, and the stream moves
 *   on; parked rows are kept 30 days for the trip page to name.
 */
import { prisma, type DbTransaction } from "../../../db";
import type { Prisma } from "../../../prisma";
import logger from "../../../utils/logger";
import { ADAPTERS } from "../adapters";
import { acceptedParties, QUEUEABLE } from "../members";
import { SHARE_ENTITIES, type ShareEntity } from "../shareTypes";
import type { AckConflict, GroupMessage } from "../../../schemas/tripSharePeer";
import { tripFederationAvailability } from "./availability";
import { recordConflict } from "./conflicts";
import { LOCAL_ERROR, kindOf } from "./peerCheck";
import { isHeld } from "./peerMember";
import { PeerRefusal } from "../../federation/refusal";
import { StreamRejected, sendOnStream, type Received } from "./streams";
import { ENTRIES_TRANSPORT, PROPAGATION_TRANSPORT } from "./transport";
import { fromWireFacts, localKeyOf } from "./wire/decode";
import { ENTRY_SHAPES } from "./wire/shapes";

const MINUTE = 60_000;
const DAY = 86_400_000;
/** After the n-th failed attempt the next one waits `BACKOFF_MS[n - 1]`, the last one repeating. */
export const BACKOFF_MS = [MINUTE, 5 * MINUTE, 30 * MINUTE, 120 * MINUTE, 720 * MINUTE, DAY];
/** Spec §7: this long after the first failure, the member is shown as unreachable. */
export const UNREACHABLE_AFTER_MS = 14 * DAY;
const PARKED_KEEP_MS = 30 * DAY;

/** The receiving server answered that it failed to apply the message (`ack rejected: error`). */
export const REMOTE_ERROR = "remote-error";
/** The receiving server holds the membership until its person confirms it (`suspended`, O9). */
export const SUSPENDED_THERE = "suspended-there";
/** Rejections that are retried, not parked: nothing is wrong with the message itself. */
const RETRIED_THERE: Partial<Record<string, string>> = {
  error: REMOTE_ERROR,
  suspended: SUSPENDED_THERE,
};
/**
 * Failures of one of the two servers themselves, not of the way between them: retried with the
 * same backoff, but never turned into `unreachable` — the other server did answer (F-S4d leftover).
 */
const NOT_THE_NETWORK = new Set([LOCAL_ERROR, REMOTE_ERROR, SUSPENDED_THERE]);

export const backoffAfter = (attempts: number): number =>
  BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];

const OUTBOX_INCLUDE = {
  group: { select: { federatedRef: true } },
  member: { include: { remote: true } },
} as const;
type Row = Prisma.TripShareOutboxGetPayload<{ include: typeof OUTBOX_INCLUDE }>;

export interface DeliveryRun {
  sent: number;
  failed: number;
  parked: number;
  dropped: number;
}

/** The members on one stream: the people of `groupId` on `peerOrigin`. */
const streamMembers = (groupId: string, peerOrigin: string) => ({
  groupId,
  remote: { origin: peerOrigin },
});

async function stillReceives(row: Row): Promise<boolean> {
  // The end of a membership is told after it ended (F-S4e): no consent or state is left to ask.
  if (row.kind === "leave") return row.member.state === "left";
  if (row.kind === "revoke") return row.member.state === "revoked";
  const live = await prisma.tripShareRemoteMember.count({
    where: { id: row.memberId, ...QUEUEABLE },
  });
  if (live === 0) return false;
  const consenting = await acceptedParties(prisma, { kind: "user", id: row.member.remote.userId }, [
    { kind: "remote", id: row.member.remoteId },
  ]);
  return consenting.size > 0;
}

function messageOf(row: Row, seq: number): GroupMessage {
  return {
    ...(row.payload as Record<string, unknown>),
    kind: row.kind,
    messageId: row.id,
    sentAt: new Date().toISOString(),
    groupRef: row.group.federatedRef,
    seq,
  } as unknown as GroupMessage;
}

/** The peer could not write some facts: the person here whose change it was sees both values. */
async function conflictHere(tx: DbTransaction, row: Row, conflicts: readonly AckConflict[]) {
  const payload = row.payload as { entity?: unknown; shareKey?: unknown };
  const entity = SHARE_ENTITIES.find((e) => e === payload.entity) as ShareEntity | undefined;
  if (!entity || typeof payload.shareKey !== "string") return;
  const shape = ENTRY_SHAPES[entity];
  const known = conflicts.filter((c) => Object.hasOwn(shape, c.field));
  const held: Record<string, unknown> = {};
  for (const c of known) {
    const parsed = shape[c.field].wire.safeParse(c.held);
    if (parsed.success) held[c.field] = parsed.data;
  }
  if (Object.keys(held).length === 0) return;
  const userId = row.member.remote.userId;
  const copy = (await ADAPTERS[entity].copiesOf(tx, payload.shareKey, row.groupId)).find(
    (r) => r.userId === userId
  );
  if (!copy?.tripId) return;
  const { remote } = row.member;
  await recordConflict(tx, {
    recipient: { id: copy.tripId, userId },
    groupId: row.groupId,
    author: {
      kind: "remote",
      pairingId: remote.id,
      displayName: remote.displayName,
      origin: remote.origin,
    },
    entity,
    copy,
    theirs: await fromWireFacts(tx, entity, held),
    keys: Object.keys(held).map((f) => localKeyOf(entity, f)),
  });
}

/** Inside the transaction that moves the stream (`sendOnStream`'s `onAck`). */
async function delivered(tx: DbTransaction, row: Row, ack: Received, now: Date): Promise<void> {
  await tx.tripShareOutbox.delete({ where: { id: row.id } });
  await tx.tripShareRemoteMember.updateMany({
    where: {
      ...streamMembers(row.groupId, row.peerOrigin),
      // A held membership (blocked, re-pinned, restored) resumes only on its person's word (O9).
      OR: [{ state: "unreachable" }, { state: "suspended", stateReason: "off" }],
    },
    data: { state: "active", stateReason: null, stateSince: now },
  });
  if (row.kind === "fact-update" && ack.conflicts?.length)
    await conflictHere(tx, row, ack.conflicts);
}

/**
 * Kept, not retried: the peer refused it for good (`schema`, `not-member`, `consent`), or it is
 * larger than any message may be (`too-large` — retrying would block the stream forever).
 */
async function park(row: Row, reason: string, field: string | null, now: Date): Promise<void> {
  logger.warn(
    { operation: "trip_share_message_parked", kind: row.kind, origin: row.peerOrigin, reason },
    "A trip-share message cannot be delivered; it is kept, not retried"
  );
  await prisma.tripShareOutbox.update({
    where: { id: row.id },
    data: { parkedAt: now, parkedReason: reason, lastError: field },
  });
}

async function failed(row: Row, kind: string, now: Date): Promise<void> {
  const attempts = row.attempts + 1;
  const failingSince = row.failingSince ?? now;
  logger.warn(
    { operation: "trip_share_delivery_retry", origin: row.peerOrigin, kind, attempts },
    "A trip-share message did not reach the other server; it is retried"
  );
  await prisma.$transaction(async (tx) => {
    await tx.tripShareOutbox.update({
      where: { id: row.id },
      data: {
        attempts,
        failingSince,
        lastError: kind,
        nextAttemptAt: new Date(now.getTime() + backoffAfter(attempts)),
      },
    });
    const members = streamMembers(row.groupId, row.peerOrigin);
    const blocked =
      kind === "remote-absent"
        ? "off"
        : /^un(known|verified)-peer$/.test(kind)
          ? "peer-blocked"
          : null;
    if (blocked)
      await tx.tripShareRemoteMember.updateMany({
        where: { ...members, state: { in: ["active", "unreachable"] } },
        data: { state: "suspended", stateReason: blocked, stateSince: now },
      });
    else if (
      !NOT_THE_NETWORK.has(kind) &&
      now.getTime() - failingSince.getTime() >= UNREACHABLE_AFTER_MS
    )
      await tx.tripShareRemoteMember.updateMany({
        where: { ...members, state: "active" },
        data: { state: "unreachable", stateReason: "unreachable", stateSince: failingSince },
      });
  });
}

/** Send one stream's due rows in order, until it is empty or a row has to wait. */
async function deliverStream(
  groupId: string,
  peerOrigin: string,
  now: Date,
  run: DeliveryRun
): Promise<void> {
  for (;;) {
    const row = await prisma.tripShareOutbox.findFirst({
      where: { groupId, peerOrigin, parkedAt: null },
      orderBy: { position: "asc" },
      include: OUTBOX_INCLUDE,
    });
    if (!row || row.nextAttemptAt > now) return;
    // Held here (a restore, a blocked server, a re-pinned key — O9): the stream waits for its
    // person's confirmation, without an attempt; nothing is sent while it is held.
    if (isHeld(row.member)) return;
    if (!row.group.federatedRef || !(await stillReceives(row))) {
      await prisma.tripShareOutbox.delete({ where: { id: row.id } });
      run.dropped++;
      continue;
    }
    const transport = row.kind === "entries" ? ENTRIES_TRANSPORT : PROPAGATION_TRANSPORT;
    try {
      await sendOnStream(
        groupId,
        peerOrigin,
        (seq) => messageOf(row, seq),
        transport,
        (tx, ack) => delivered(tx, row, ack, now)
      );
    } catch (error) {
      // The other server failed to apply it for a reason of its own, or holds the membership
      // until its person confirms it again: retried, each named as itself.
      if (error instanceof StreamRejected && RETRIED_THERE[error.ack.rejected]) {
        await failed(row, RETRIED_THERE[error.ack.rejected] as string, now);
        run.failed++;
        return;
      }
      if (error instanceof StreamRejected && error.ack.rejected !== "gap") {
        await park(row, error.ack.rejected, error.ack.field ?? null, now);
        run.parked++;
        continue;
      }
      // Too large in bytes for its transport: the same bytes would be refused on every retry.
      if (error instanceof PeerRefusal && error.kind === "packet-too-large") {
        await park(row, "too-large", null, now);
        run.parked++;
        continue;
      }
      const kind = error instanceof StreamRejected ? "gap" : kindOf(error);
      if (kind === LOCAL_ERROR)
        logger.error(
          { operation: "trip_share_delivery_local_error", origin: peerOrigin, err: error },
          "A trip-share message failed on this server; it is retried"
        );
      await failed(row, kind, now);
      run.failed++;
      return;
    }
    run.sent++;
  }
}

async function deliverAll(now: Date): Promise<DeliveryRun> {
  const run: DeliveryRun = { sent: 0, failed: 0, parked: 0, dropped: 0 };
  // Off here: the rows wait. Off is absent (G5) — nothing leaves, nothing is lost.
  if (!(await tripFederationAvailability()).available) return run;
  await prisma.tripShareOutbox.deleteMany({
    where: { parkedAt: { lt: new Date(now.getTime() - PARKED_KEEP_MS) } },
  });
  const streams = await prisma.tripShareOutbox.groupBy({
    by: ["groupId", "peerOrigin"],
    where: { parkedAt: null, nextAttemptAt: { lte: now } },
  });
  for (const s of streams) {
    try {
      await deliverStream(s.groupId, s.peerOrigin, now, run);
    } catch (err) {
      // One stream's surprise must not hold up the others; its row stays for the next run.
      logger.error(
        { operation: "trip_share_delivery_failed", origin: s.peerOrigin, err },
        "Trip-share delivery failed"
      );
    }
  }
  return run;
}

let current: Promise<DeliveryRun> | null = null;

/**
 * One delivery pass over every stream with a due row. Passes run one after another, never two at
 * once in this process (a second call waits for the first, then runs). `now` decides what is
 * due and what a failure's backoff counts from — tests move it instead of waiting.
 */
export function runDeliveries(now?: Date): Promise<DeliveryRun> {
  const pass = () => deliverAll(now ?? new Date());
  const next = (current ?? Promise.resolve()).then(pass, pass);
  current = next;
  void next
    .catch(() => undefined)
    .finally(() => {
      if (current === next) current = null;
    });
  return next;
}
