/**
 * The host's half of the join (spec 2026-10-17 §6.5 steps 1, 2 and 4): the owner invites a person
 * on a verified peer server, the person opens the link, the host sends their browser to their own
 * server to be vouched for, and the vouch it brings back opens a session for this one plan.
 *
 * Every refusal reads the same to a stranger (`PLAN_GUEST_INVITE_INVALID`, `PLAN_GUEST_VOUCH_
 * INVALID`); the operator's log names the cause. Single use is enforced by conditional updates
 * (`usedAt IS NULL` -> count 1), never by a read followed by a write.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import logger from "../../../utils/logger";
import { assertOwner, planAccess } from "../access";
import { MAX_PLAN_MEMBERS } from "../members";
import type { PlanMember } from "../types";
import { guestIdentity, requireVerifiedPeer, verifiedPeer } from "./peers";
import { hashToken, issueCredential, sweepGuestRows } from "./sessions";
import { VouchRefused, claimedIssuer, verifyVouch } from "./vouch";

export const INVITE_DAYS = 7;
export const JOIN_MINUTES = 10;
/** Remote members (invited or active) on this host, over all plans. */
export const MAX_REMOTE_MEMBERS = 20;
export const JOIN_COOKIE = "ts_guest_join";

const invalidInvite = () =>
  new AppError("This invitation is not valid", 404, "PLAN_GUEST_INVITE_INVALID");
const invalidVouch = (fault: string) => {
  logger.warn({ operation: "travplan.guest.vouchRefused", fault }, "guest vouch refused");
  return new AppError(
    "The confirmation from the guest's server was refused",
    403,
    "PLAN_GUEST_VOUCH_INVALID"
  );
};

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function toMember(row: {
  id: string;
  displayName: string;
  status: string;
  invitedAt: Date;
  joinedAt: Date | null;
  sharedAt: Date | null;
}): PlanMember {
  return {
    id: row.id,
    kind: "remote",
    displayName: row.displayName,
    username: null,
    role: "editor",
    status: row.status === "active" || row.status === "invited" ? row.status : "revoked",
    createdAt: row.invitedAt.toISOString(),
    decidedAt: row.joinedAt?.toISOString() ?? null,
    shared: false,
  };
}

async function newInvite(
  tx: Pick<typeof prisma, "travelPlanGuestInvite">,
  memberId: string,
  hostOrigin: string
) {
  const secret = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const invite = await tx.travelPlanGuestInvite.create({
    data: { memberId, secretHash: hashToken(secret), expiresAt },
  });
  return {
    link: `${hostOrigin}/plan/join#${invite.id}.${secret}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export interface GuestInviteResult {
  member: PlanMember;
  link: string;
  expiresAt: string;
}

/** Owner: invites a person on a verified peer server. `username` is display only. */
export async function inviteGuest(
  ownerId: string,
  tripId: string,
  input: { origin: string; username: string }
): Promise<GuestInviteResult> {
  const access = await planAccess(ownerId, tripId);
  assertOwner(access);
  const identity = await guestIdentity();
  if (input.origin === identity.origin)
    throw new AppError("That is this server", 400, "PLAN_GUEST_PEER_NOT_ADMITTED", undefined, {
      origin: input.origin,
    });
  await requireVerifiedPeer(input.origin);
  const planId = access.row.id;
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM travel_plans WHERE id = ${planId} FOR UPDATE`;
    // The host-wide cap spans plans, so it needs a lock wider than the plan row.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('travplan-guest-limit'))`;
    const open = await tx.travelPlanMember.count({
      where: { planId, kind: { not: "owner" }, status: { in: ["invited", "active"] } },
    });
    if (open >= MAX_PLAN_MEMBERS) throw new AppError("Too many members", 409, "PLAN_MEMBER_LIMIT");
    const hostWide = await tx.travelPlanMember.count({
      where: { kind: "remote", status: { in: ["invited", "active"] } },
    });
    if (hostWide >= MAX_REMOTE_MEMBERS)
      throw new AppError("Too many guests on this server", 409, "PLAN_GUEST_LIMIT");
    const member = await tx.travelPlanMember.create({
      data: {
        planId,
        kind: "remote",
        remoteOrigin: input.origin,
        displayName: input.username.trim().slice(0, 100),
        role: "editor",
        status: "invited",
      },
    });
    return { member, ...(await newInvite(tx, member.id, identity.origin)) };
  });
  return { member: toMember(result.member), link: result.link, expiresAt: result.expiresAt };
}

/** Owner: a fresh link for a guest who has not joined yet; the old link dies. */
export async function reissueGuestInvite(
  ownerId: string,
  tripId: string,
  memberId: string
): Promise<GuestInviteResult> {
  const access = await planAccess(ownerId, tripId);
  assertOwner(access);
  const identity = await guestIdentity();
  const member = await prisma.travelPlanMember.findFirst({
    where: { id: memberId, planId: access.row.id, kind: "remote", status: "invited" },
  });
  if (!member) throw new AppError("Member not found", 404, "PLAN_MEMBER_NOT_FOUND");
  const fresh = await prisma.$transaction(async (tx) => {
    await tx.travelPlanGuestInvite.deleteMany({ where: { memberId: member.id } });
    return newInvite(tx, member.id, identity.origin);
  });
  return { member: toMember(member), link: fresh.link, expiresAt: fresh.expiresAt };
}

export interface JoinStart {
  /** Where the browser goes next: the guest's own server, to be vouched for. */
  vouchUrl: string;
  guestOrigin: string;
  host: string;
  /** The value of the browser-binding cookie (HttpOnly; the caller sets it). */
  browserToken: string;
}

/** Step 2: the link's holder proves the secret; the host binds a fresh nonce to this browser. */
export async function startJoin(input: { inviteId: string; secret: string }): Promise<JoinStart> {
  const invite = await prisma.travelPlanGuestInvite.findUnique({
    where: { id: input.inviteId },
    include: { member: true },
  });
  // Unknown, wrong secret, used, expired, withdrawn: one answer.
  if (
    !invite ||
    !same(invite.secretHash, hashToken(input.secret)) ||
    invite.usedAt ||
    invite.expiresAt <= new Date() ||
    invite.member.kind !== "remote" ||
    invite.member.status !== "invited" ||
    !invite.member.remoteOrigin
  )
    throw invalidInvite();
  const guestOrigin = invite.member.remoteOrigin;
  await requireVerifiedPeer(guestOrigin);
  // Housekeeping rides on the one unauthenticated entry; a failure never blocks a join.
  await sweepGuestRows().catch(() => 0);
  const identity = await guestIdentity();
  const nonce = randomBytes(32).toString("hex");
  const browserToken = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    // A new attempt replaces the open ones for this invitation.
    prisma.travelPlanGuestJoin.deleteMany({ where: { inviteId: invite.id, usedAt: null } }),
    prisma.travelPlanGuestJoin.create({
      data: {
        inviteId: invite.id,
        memberId: invite.memberId,
        nonce,
        browserHash: hashToken(browserToken),
        expiresAt: new Date(Date.now() + JOIN_MINUTES * 60_000),
      },
    }),
  ]);
  const query = new URLSearchParams({ host: identity.origin, invite: invite.id, nonce });
  return {
    vouchUrl: `${guestOrigin}/federation/vouch?${query}`,
    guestOrigin,
    host: identity.origin,
    browserToken,
  };
}

export interface JoinResult {
  token: string;
  expiresAt: Date;
  tripId: string;
  planId: string;
  memberId: string;
}

/** Step 4: verify the vouch, consume nonce and invitation exactly once, open the session. */
export async function completeJoin(input: {
  vouch: string;
  browserToken: string | undefined;
}): Promise<JoinResult> {
  if (!input.browserToken)
    throw new AppError("Join was not started in this browser", 400, "PLAN_GUEST_JOIN_NOT_STARTED");
  const identity = await guestIdentity();
  let vouch;
  try {
    const issuer = claimedIssuer(input.vouch);
    // A server the admin has not admitted has no key we trust: nothing to verify against.
    const peer = await verifiedPeer(issuer);
    if (!peer) throw invalidVouch("unknown-issuer");
    vouch = verifyVouch(input.vouch, peer.publicKey, identity.origin);
  } catch (error) {
    if (error instanceof VouchRefused) throw invalidVouch(error.fault);
    throw error;
  }
  const join = await prisma.travelPlanGuestJoin.findUnique({
    where: { nonce: vouch.nonce },
    include: {
      invite: true,
      member: { include: { plan: { select: { id: true, tripId: true } } } },
    },
  });
  if (!join || !same(join.browserHash, hashToken(input.browserToken)))
    throw invalidVouch("nonce-not-bound");
  if (join.usedAt || join.expiresAt <= new Date()) throw invalidVouch("nonce-used-or-expired");
  if (
    join.invite.id !== vouch.invite ||
    join.member.kind !== "remote" ||
    join.member.remoteOrigin !== vouch.iss
  )
    throw invalidVouch("invite-mismatch");
  const now = new Date();
  let session: { token: string; expiresAt: Date };
  try {
    // Consuming the nonce and the invitation, activating the member and opening the session are
    // one transaction: a failure leaves the invitation usable, never an active member without
    // a credential.
    session = await prisma.$transaction(async (tx) => {
      const nonce = await tx.travelPlanGuestJoin.updateMany({
        where: { id: join.id, usedAt: null },
        data: { usedAt: now },
      });
      const invite = await tx.travelPlanGuestInvite.updateMany({
        where: { id: join.invite.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (nonce.count !== 1 || invite.count !== 1) throw invalidInvite();
      const activated = await tx.travelPlanMember.updateMany({
        where: { id: join.memberId, kind: "remote", status: "invited" },
        data: {
          status: "active",
          joinedAt: now,
          remoteSubject: vouch.sub,
          displayName: vouch.name,
        },
      });
      if (activated.count !== 1) throw invalidInvite();
      return issueCredential(
        {
          memberId: join.memberId,
          planId: join.member.plan.id,
          kind: "session",
          origin: vouch.iss,
        },
        tx
      );
    });
  } catch (error) {
    // The same person already holds an active place on this plan.
    if ((error as { code?: string }).code === "P2002")
      throw new AppError("This person is already on the plan", 409, "PLAN_MEMBER_DUPLICATE");
    throw error;
  }
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    tripId: join.member.plan.tripId,
    planId: join.member.plan.id,
    memberId: join.memberId,
  };
}
