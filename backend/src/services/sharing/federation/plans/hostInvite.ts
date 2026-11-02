/**
 * The owner's side (spec 2026-11-02 §4): which connections can be invited into a plan, and the
 * invitation itself. The member is bound to the owner's side of the connection; the invitation is
 * sent first-class (a miss is the owner's to see and retry), and a member whose person's server
 * never got it does not stay on the plan as an open invitation nobody can answer.
 */
import { prisma } from "../../../../db";
import { AppError } from "../../../../middleware/errorHandler";
import { PERSON_SELECT, toPerson } from "../../people";
import { assertOwner, planAccess } from "../../../travplan/access";
import { MAX_PLAN_MEMBERS } from "../../../travplan/members";
import type { PlanMember } from "../../../travplan/types";
import { requireTripFederation } from "../access";
import { remoteShareError } from "../errors";
import { peerSupports } from "../peerFeatures";
import { requireAdmitted } from "../peerCheck";
import { connectionAllowsPlans } from "../connections/switches";
import { messageHeader } from "../transport";
import { PlanPeerUnreachable, callPeer } from "./peerCall";

export interface PlanConnectionOption {
  connectionId: string;
  displayName: string;
  username: string;
  origin: string;
  /** Already invited or on the plan. */
  member: boolean;
}

/** Active connections with plans on at both sides, for "Mitplaner hinzufügen". */
export async function eligiblePlanConnections(
  ownerId: string,
  tripId: string
): Promise<PlanConnectionOption[]> {
  await requireTripFederation(ownerId);
  const access = await planAccess(ownerId, tripId);
  assertOwner(access);
  const [rows, members] = await Promise.all([
    prisma.remoteShareAccount.findMany({
      where: { userId: ownerId, state: "active", sharePlans: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.travelPlanMember.findMany({
      where: {
        planId: access.row.id,
        kind: "remote",
        status: { in: ["invited", "active"] },
        connectionId: { not: null },
      },
      select: { connectionId: true },
    }),
  ]);
  const taken = new Set(members.map((m) => m.connectionId));
  return rows.filter(connectionAllowsPlans).map((r) => ({
    connectionId: r.id,
    displayName: r.displayName,
    username: r.username,
    origin: r.origin,
    member: taken.has(r.id),
  }));
}

const notShared = (userId: string, origin: string) =>
  remoteShareError(
    "SHARE_REMOTE_CONNECTION_STATE",
    409,
    "Plans are not switched on for that connection on both sides",
    { userId, origin },
    { origin }
  );

export async function inviteRemoteMember(
  ownerId: string,
  tripId: string,
  connectionId: string
): Promise<PlanMember> {
  await requireTripFederation(ownerId);
  const access = await planAccess(ownerId, tripId);
  assertOwner(access);
  const account = await prisma.remoteShareAccount.findFirst({
    where: { id: connectionId, userId: ownerId },
  });
  if (!account)
    throw remoteShareError("SHARE_REMOTE_PERSON_NOT_FOUND", 404, "No such person", {
      userId: ownerId,
    });
  if (!connectionAllowsPlans(account)) throw notShared(ownerId, account.origin);
  await requireAdmitted(ownerId, account.origin);
  if (!(await peerSupports(account.origin, "plans").catch(() => false)))
    throw remoteShareError(
      "SHARE_REMOTE_PEER_OUTDATED",
      409,
      "That server needs an update",
      { userId: ownerId, origin: account.origin },
      { origin: account.origin }
    );
  const planId = access.row.id;
  const owner = await prisma.user.findUniqueOrThrow({
    where: { id: ownerId },
    select: PERSON_SELECT,
  });
  // The plan row is locked for the count and the write: two invitations at once cannot both find
  // room for the last place, and one person is one row.
  const placed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM travel_plans WHERE id = ${planId} FOR UPDATE`;
    const existing = await tx.travelPlanMember.findFirst({
      where: { planId, kind: "remote", connectionId },
    });
    // Inviting someone already invited or on the plan sends the invitation again and changes
    // nothing here: it is how a pointer the member's server dropped (a refusal while a switch was
    // off) is restored, and a repeated click is harmless.
    if (existing && (existing.status === "invited" || existing.status === "active"))
      return { row: existing, fresh: false };
    const open = await tx.travelPlanMember.count({
      where: { planId, kind: { not: "owner" }, status: { in: ["invited", "active"] } },
    });
    if (open >= MAX_PLAN_MEMBERS) throw new AppError("Too many members", 409, "PLAN_MEMBER_LIMIT");
    const data = {
      displayName: account.displayName,
      remoteOrigin: account.origin,
      status: "invited",
      invitedAt: new Date(),
      joinedAt: null,
      revokedAt: null,
      sharedAt: null,
    };
    const row = existing
      ? await tx.travelPlanMember.update({ where: { id: existing.id }, data })
      : await tx.travelPlanMember.create({
          data: { ...data, planId, kind: "remote", connectionId, role: "editor" },
        });
    return { row, fresh: true };
  });
  const member = placed.row;
  // A fresh invitation the other server never got is withdrawn; a resent one was there before.
  const withdraw = async () => {
    if (!placed.fresh) return;
    await prisma.travelPlanMember.updateMany({
      where: { id: member.id, status: "invited" },
      data: { status: "revoked", revokedAt: new Date() },
    });
  };
  try {
    const reply = await callPeer(account.origin, {
      kind: "plan-invite",
      ...messageHeader(),
      from: account.localChannel,
      to: account.channel,
      planId,
      tripId,
      tripTitle: access.row.trip.name.slice(0, 200) || "Plan",
      ownerDisplayName: toPerson(owner).displayName.slice(0, 160),
    });
    if (reply.status !== "ok") {
      await withdraw();
      throw notShared(ownerId, account.origin);
    }
  } catch (error) {
    if (error instanceof PlanPeerUnreachable) {
      await withdraw();
      throw remoteShareError(
        "SHARE_REMOTE_UNREACHABLE",
        502,
        "That server does not answer",
        { userId: ownerId, origin: account.origin, kind: error.kind },
        { origin: account.origin }
      );
    }
    throw error;
  }
  return {
    id: member.id,
    kind: "remote",
    displayName: member.displayName,
    username: account.username,
    role: "editor",
    status: member.status === "active" ? "active" : "invited",
    createdAt: member.invitedAt.toISOString(),
    decidedAt: member.joinedAt?.toISOString() ?? null,
    shared: false,
  };
}
