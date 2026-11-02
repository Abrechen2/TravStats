/**
 * The member side of plans over a connection, the part the HOST calls (spec 2026-11-02 §4): the
 * invitation. The route has authenticated the peer; the signed channel pair resolves to this
 * person's side of the connection, and the invitation is kept only when that connection is active
 * with plans on at both sides. Everything else is `notShared`, the one refusal.
 */
import { prisma } from "../../../../db";
import type { PlanInvite, PlanReply } from "../../../../schemas/tripSharePlans";
import { tripFederationAvailability } from "../availability";
import { connectionAllowsPlans } from "../connections/switches";
import { connectionOf } from "./hostServe";
import { MAX_OPEN_INVITES } from "./shared";

const ok: PlanReply = { kind: "plan-reply", status: "ok" };
const notShared: PlanReply = { kind: "plan-reply", status: "notShared" };

export async function servePlanInvite(origin: string, body: PlanInvite): Promise<PlanReply> {
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin } });
  if (!peer?.enabled || !peer.verifiedAt) return notShared;
  const account = await connectionOf(origin, body.from, body.to);
  if (!account || !connectionAllowsPlans(account)) return notShared;
  const existing = await prisma.remotePlanMembership.findUnique({
    where: { connectionId_planId: { connectionId: account.id, planId: body.planId } },
  });
  if (existing?.state === "active" || existing?.state === "invited") {
    // The same plan invited again (a title changed, a lost answer): the pointer is refreshed.
    await prisma.remotePlanMembership.update({
      where: { id: existing.id },
      data: { title: body.tripTitle, ownerDisplayName: body.ownerDisplayName, tripId: body.tripId },
    });
    return ok;
  }
  const open = await prisma.remotePlanMembership.count({
    where: { userId: account.userId, state: "invited" },
  });
  if (open >= MAX_OPEN_INVITES) return notShared;
  const data = {
    userId: account.userId,
    tripId: body.tripId,
    title: body.tripTitle,
    ownerDisplayName: body.ownerDisplayName,
    role: "editor",
    state: "invited",
    invitedAt: new Date(),
    joinedAt: null,
    endedAt: null,
  };
  await prisma.remotePlanMembership.upsert({
    where: { connectionId_planId: { connectionId: account.id, planId: body.planId } },
    create: { ...data, connectionId: account.id, planId: body.planId },
    update: data,
  });
  return ok;
}

/** Open plan invitations of a person: part of the inbox badge. 0 while sharing across servers is off. */
export async function countPlanInvites(userId: string): Promise<number> {
  if (!(await tripFederationAvailability()).available) return 0;
  return prisma.remotePlanMembership.count({
    where: { userId, state: "invited", connection: { state: "active" } },
  });
}
