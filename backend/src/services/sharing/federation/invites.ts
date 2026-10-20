/**
 * The inviting side of an invitation (spec 2026-10-20 F1, phase F-S4b): issue, list and revoke a
 * code, and redeem one when another server's user claims it.
 *
 * A code is single use, valid 72 h and bound to the user who issued it: only the SHA-256 of its
 * secret is stored, only that user lists or revokes it, and redeeming it pairs exactly that user
 * with the claimant. Redeeming it is also both people's yes (F3): the issuer said yes by issuing,
 * the claimant by claiming on their own server — so the pair is stored as accepted on each side.
 */
import { randomBytes, randomUUID } from "crypto";
import { prisma, type DbTransaction } from "../../../db";
import { hash, refused } from "../../federation/refusal";
import { PERSON_SELECT, toPerson } from "../people";
import type { InviteClaim, InviteClaimReply, InviteRefusal } from "../../../schemas/tripSharePeer";
import { requireTripFederation } from "./access";
import { remoteShareError } from "./errors";
import { formatTripInviteCode } from "./inviteCode";

export const INVITE_TTL_MS = 72 * 3_600_000;
export const OPEN_INVITE_LIMIT = 20;

export interface TripInviteView {
  id: string;
  createdAt: string;
  expiresAt: string;
}

/** Serialises one user's invitation writes, so parallel requests cannot all pass the count. */
async function lockInvites(tx: DbTransaction, userId: string): Promise<void> {
  const key = `trip-share-invites|${userId}`;
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))) l`;
}

const open = (userId: string) => ({ userId, usedAt: null, expiresAt: { gt: new Date() } });

/** A new code. Shown to the issuer once: only its hash is kept. */
export async function createTripInvite(userId: string): Promise<TripInviteView & { code: string }> {
  const local = await requireTripFederation(userId);
  const secret = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const row = await prisma.$transaction(async (tx) => {
    await lockInvites(tx, userId);
    if ((await tx.tripShareInvite.count({ where: open(userId) })) >= OPEN_INVITE_LIMIT)
      throw remoteShareError("SHARE_REMOTE_INVITE_LIMIT", 429, "Too many open invitations", {
        userId,
      });
    return tx.tripShareInvite.create({ data: { hash: hash(secret), userId, expiresAt } });
  });
  return {
    id: row.id,
    code: formatTripInviteCode(local.origin, secret),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** The caller's codes that can still be redeemed, newest first. Never the code itself. */
export async function listTripInvites(userId: string): Promise<TripInviteView[]> {
  await requireTripFederation(userId);
  const rows = await prisma.tripShareInvite.findMany({
    where: open(userId),
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
  }));
}

/** Withdraws an unused code; a claim then reads it as unknown. Another user's id is not found. */
export async function revokeTripInvite(userId: string, inviteId: string): Promise<void> {
  await requireTripFederation(userId);
  const removed = await prisma.tripShareInvite.deleteMany({
    where: { id: inviteId, userId, usedAt: null },
  });
  if (removed.count === 0)
    throw remoteShareError("SHARE_REMOTE_INVITE_NOT_FOUND", 404, "No such open invitation", {
      userId,
    });
}

const refusal = (reason: InviteRefusal): InviteClaimReply => ({
  kind: "invite-claim-reply",
  accepted: false,
  reason,
});

/** Live pairing of `userId` with that person on that server: a second code would duplicate it. */
async function hasLivePairing(tx: DbTransaction, userId: string, origin: string, username: string) {
  const live = { status: { in: ["pending", "accepted"] } };
  return (
    (await tx.remoteShareAccount.count({
      where: {
        userId,
        origin,
        username,
        OR: [{ consentsTargeted: { some: live } }, { consentsRequested: { some: live } }],
      },
    })) > 0
  );
}

/**
 * Another server's user redeems a code (`invite-claim`). The route has already authenticated the
 * peer (signature, purpose `trip-share/1`, admitted and verified) and consumed the nonce;
 * everything in `body` is still that server's word.
 */
export async function serveInviteClaim(
  origin: string,
  body: InviteClaim
): Promise<InviteClaimReply> {
  return prisma.$transaction(async (tx) => {
    const invite = await tx.tripShareInvite.findUnique({
      where: { hash: hash(body.code) },
      include: { user: { select: { ...PERSON_SELECT, isActive: true } } },
    });
    if (!invite || !invite.user.isActive) return refusal("unknown");
    if (invite.usedAt) return refusal("used");
    if (invite.expiresAt <= new Date()) return refusal("expired");
    await lockInvites(tx, invite.userId);
    // Before the code is spent, so the issuer can hand it to someone else.
    if (await hasLivePairing(tx, invite.userId, origin, body.username)) return refusal("duplicate");
    // A channel that server already gave us names another pairing: a protocol error on its side.
    const taken = await tx.remoteShareAccount.findUnique({
      where: { origin_channel: { origin, channel: body.channel } },
      select: { id: true },
    });
    if (taken) throw refused("malformed");
    // Conditional on still being unused: two claims racing for one code must not both win.
    const used = await tx.tripShareInvite.updateMany({
      where: { id: invite.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) return refusal("used");
    const localChannel = randomUUID();
    const remote = await tx.remoteShareAccount.create({
      data: {
        userId: invite.userId,
        origin,
        channel: body.channel,
        localChannel,
        username: body.username,
        displayName: body.displayName,
      },
    });
    await tx.shareConsent.create({
      data: {
        requesterId: invite.userId,
        remoteTargetId: remote.id,
        status: "accepted",
        decidedAt: new Date(),
      },
    });
    const inviter = toPerson(invite.user);
    return {
      kind: "invite-claim-reply",
      accepted: true,
      channel: localChannel,
      username: inviter.username,
      displayName: inviter.displayName,
      federatedRef: null,
    };
  });
}
