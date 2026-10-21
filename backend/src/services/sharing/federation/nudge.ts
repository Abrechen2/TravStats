/**
 * "Deliver now" (spec 2026-10-20, Q6 of 2026-10-21). A message the other server answered
 * `suspended` is retried at the outbox backoff — up to a day. Once the person there confirms the
 * trip again, their server sends a signed `nudge` naming the pairing, and this server retries its
 * waiting messages for that pairing at once.
 *
 * Sending is best effort and after the confirmation committed: a peer that does not name the
 * feature (rc.18) is not sent one, and a failure is logged, never shown as the confirmation's.
 *
 * Receiving is rate-limited per server — one nudge a minute is looked at, the rest are answered
 * `{ nudged: false }` — so a peer cannot make this server hammer it (or anyone). A nudge moves
 * only rows that already wait for that server, on the streams the pairing's memberships use.
 */
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { nudgeReplySchema, type NudgeMessage } from "../../../schemas/tripSharePeer";
import { kickDelivery } from "./deliveryKick";
import { peerSupports } from "./peerFeatures";
import { messageHeader, tripShareExchange } from "./transport";

/** At most one nudge per sending server is looked at in this long. */
export const NUDGE_INTERVAL_MS = 60_000;
const lastSeen = new Map<string, number>();

/** A pairing as this server names it: the other server, its channel, ours. */
export interface NudgeTarget {
  origin: string;
  channel: string;
  localChannel: string;
}

let sending: Promise<void> = Promise.resolve();

async function nudgeOne(target: NudgeTarget): Promise<void> {
  try {
    if (!(await peerSupports(target.origin, "nudge"))) return;
    const reply = nudgeReplySchema.parse(
      await tripShareExchange(target.origin, {
        kind: "nudge",
        ...messageHeader(),
        from: target.localChannel,
        to: target.channel,
      })
    );
    logger.info(
      { operation: "trip_share_nudge_sent", origin: target.origin, nudged: reply.nudged },
      "Asked the other server to deliver its waiting messages now"
    );
  } catch (err) {
    logger.warn(
      { operation: "trip_share_nudge_failed", origin: target.origin, err },
      "The other server could not be asked to deliver now; it retries at its own pace"
    );
  }
}

/** Nudge each pairing once, in the background (after the caller's commit). */
export function nudgePeers(targets: readonly NudgeTarget[]): void {
  const unique = new Map(targets.map((t) => [`${t.origin}|${t.channel}|${t.localChannel}`, t]));
  sending = sending.then(async () => {
    for (const t of unique.values()) await nudgeOne(t);
  });
}

/** Tests: wait until every nudge started so far has been sent (or failed). */
export function settleNudges(): Promise<void> {
  return sending;
}

/** Tests: forget the rate limit's memory. */
export function forgetNudges(): void {
  lastSeen.clear();
}

/** A nudge arrives from `origin`: retry what waits for that pairing now, at most once a minute. */
export async function serveNudge(
  origin: string,
  message: NudgeMessage,
  now: Date = new Date()
): Promise<{ nudged: boolean }> {
  const last = lastSeen.get(origin);
  if (last !== undefined && now.getTime() - last < NUDGE_INTERVAL_MS) return { nudged: false };
  lastSeen.set(origin, now.getTime());
  const pairing = await prisma.remoteShareAccount.findFirst({
    where: { origin, channel: message.from, localChannel: message.to },
    select: { id: true },
  });
  if (!pairing) return { nudged: false };
  const groups = await prisma.tripShareRemoteMember.findMany({
    where: { remoteId: pairing.id },
    select: { groupId: true },
  });
  if (groups.length === 0) return { nudged: false };
  // The whole stream, not only this pairing's rows: a stream sends in order, so a waiting row of
  // someone else at its head would hold the pairing's rows behind it.
  const { count } = await prisma.tripShareOutbox.updateMany({
    where: {
      peerOrigin: origin,
      groupId: { in: [...new Set(groups.map((g) => g.groupId))] },
      parkedAt: null,
      nextAttemptAt: { gt: now },
    },
    data: { nextAttemptAt: now },
  });
  if (count > 0) kickDelivery();
  return { nudged: true };
}
