/**
 * The leaderboard half of the signed peer endpoint (spec §9.3). Owner decision 2026-10-16:
 * these totals cross servers WITHOUT end-to-end encryption, over the Ed25519-signed link of two
 * admin-pinned servers. Nothing here returns a record.
 *
 * A remote friend is addressed by (origin of the signed envelope, channel). The channel is a
 * random UUID this server minted at the claim, so a second admitted peer cannot use a channel
 * that belongs to another one — the lookup includes the origin.
 *
 * The route has already refused an unpinned, suspended or unverified peer before any of these
 * runs; everything in `body` is still the other server's word and is treated as such.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../db";
import { PERSON_SELECT, toPerson } from "../sharing/people";
import { hash, refused } from "../federation/refusal";
import {
  SERVED_VERSIONS,
  type AggregateReply,
  type AggregateRequest,
  type LbClaimReply,
  type LbClaimRequest,
  type LbStateRequest,
} from "../../schemas/comparison";
import { buildLeaderboardSnapshot } from "./aggregates";
import { lockRemotePair, readScope } from "./consents";

export async function serveAggregate(
  origin: string,
  body: AggregateRequest
): Promise<AggregateReply> {
  const remote = await prisma.leaderboardRemote.findUnique({
    where: { origin_channel: { origin, channel: body.channel } },
  });
  if (!remote) throw refused("unknown-channel");
  if (!SERVED_VERSIONS.some((v) => body.accept.includes(v)))
    return { status: "unsupportedVersion", supported: [...SERVED_VERSIONS] };
  const consent = await prisma.leaderboardConsent.findUnique({
    where: { ownerId_remoteId: { ownerId: remote.userId, remoteId: remote.id } },
    include: { owner: { select: { isActive: true } } },
  });
  if (!consent || !consent.owner.isActive) return { status: "notShared" };
  if (consent.status === "withdrawn") return { status: "withdrawn" };
  // Only an accepted row is ever read: a pending offer already carries a scope, and must not
  // show it before the other side has answered.
  if (consent.status !== "accepted") return { status: "notShared" };
  // A scope that no longer parses costs this one friend their numbers, never the request.
  const scope = readScope(consent.scope, consent.id);
  if (!scope) return { status: "notShared" };
  if (scope.year !== null && scope.year !== body.year)
    return { status: "yearNotShared", year: scope.year };
  return {
    status: "ok",
    snapshot: await buildLeaderboardSnapshot(remote.userId, scope, body.year),
  };
}

/**
 * Someone on the asking server redeemed one of our users' invitation codes. The inviter is
 * asked (a question: pending, no scope, undecided) before their totals are served; the
 * claimant's server asserted the claimant's name under its signature.
 *
 * An unknown, used, expired or orphaned code all read `{ accepted: false }` alike, so the
 * reply says nothing about which codes or users exist.
 */
export async function serveClaim(origin: string, body: LbClaimRequest): Promise<LbClaimReply> {
  return prisma.$transaction(async (tx) => {
    const invite = await tx.leaderboardInvite.findUnique({
      where: { hash: hash(body.code) },
      include: { user: { select: { ...PERSON_SELECT, isActive: true } } },
    });
    if (!invite || invite.usedAt || invite.expiresAt <= new Date() || !invite.user.isActive)
      return { accepted: false as const };
    // Conditional on still being unused: two claims racing for one code must not both win.
    const used = await tx.leaderboardInvite.updateMany({
      where: { hash: invite.hash, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) return { accepted: false as const };
    const channel = randomUUID();
    const remote = await tx.leaderboardRemote.create({
      data: {
        userId: invite.userId,
        origin,
        channel,
        username: body.username,
        displayName: body.displayName,
      },
    });
    // The pair is brand new, so nobody else can hold it yet; taken anyway so every writer of a
    // remote pair follows the one rule.
    await lockRemotePair(tx, invite.userId, remote.id);
    await tx.leaderboardConsent.create({ data: { ownerId: invite.userId, remoteId: remote.id } });
    const inviter = toPerson(invite.user);
    return {
      accepted: true as const,
      channel,
      username: inviter.username,
      displayName: inviter.displayName,
    };
  });
}

/**
 * The other server reports the friendship ended. Both directions go: the remote row and, by
 * cascade, the consent. Under the pair lock, so it cannot interleave with the owner answering.
 */
export async function serveState(origin: string, body: LbStateRequest): Promise<{ ok: true }> {
  return prisma.$transaction(async (tx) => {
    const remote = await tx.leaderboardRemote.findUnique({
      where: { origin_channel: { origin, channel: body.channel } },
    });
    if (!remote) throw refused("unknown-channel");
    await lockRemotePair(tx, remote.userId, remote.id);
    const removed = await tx.leaderboardRemote.deleteMany({
      where: { id: remote.id, origin, channel: body.channel },
    });
    if (removed.count === 0) throw refused("unknown-channel");
    return { ok: true as const };
  });
}
